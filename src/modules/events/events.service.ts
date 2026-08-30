import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { describeInstance } from '../sponsors/instance-label';
import { SponsorUserDto } from '../sponsors/dto/sponsor.dto';
import {
  CreateEventDto,
  EventRecordDto,
  EventsSummaryDto,
  QueryEventsDto,
  ScheduleGroupDto,
  UpdateEventDto,
} from './dto/event.dto';
import { PublicEventDto } from './dto/public-event.dto';
import { deriveEventStatus, isOverdue } from './event-status';

const SPONSOR_SELECT = {
  id: true,
  nameTa: true,
  fullName: true,
  email: true,
  phone: true,
  address: true,
} satisfies Prisma.UserSelect;

const EVENT_INCLUDE = {
  eventType: true,
  sponsor: { select: SPONSOR_SELECT },
} satisfies Prisma.EventInclude;

/** The public site sees a sponsor's name and nothing else — see PublicEventDto. */
const PUBLIC_INCLUDE = {
  eventType: true,
  sponsor: { select: { nameTa: true, fullName: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;
type PublicEventRow = Prisma.EventGetPayload<{ include: typeof PUBLIC_INCLUDE }>;
type SponsorRow = Prisma.UserGetPayload<{ select: typeof SPONSOR_SELECT }>;

/** `HH:mm` on an arbitrary date — Postgres `time` carries no day. */
const timeToDate = (value: string): Date => new Date(`1970-01-01T${value}:00Z`);
const dateToTime = (value: Date): string => value.toISOString().slice(11, 16);

/** `scheduled_date` is a Postgres `date`, so it compares against UTC midnight. */
const startOfUtcDay = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryEventsDto, canSeeContact: boolean): Promise<EventRecordDto[]> {
    const events = await this.prisma.event.findMany({
      where: {
        eventTypeId: query.eventTypeId,
        isCompleted: query.isCompleted,
        sponsorId: query.unsponsoredOnly ? null : undefined,
        scheduledDate: this.dateRange(query),
      },
      include: EVENT_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
    });

    return events.map((event) => this.toRecord(event, canSeeContact));
  }

  async findOneOrFail(id: number, canSeeContact: boolean): Promise<EventRecordDto> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });

    if (!event) throw new NotFoundException(`Event ${id} was not found`);

    return this.toRecord(event, canSeeContact);
  }

  async summary(year = new Date().getFullYear()): Promise<EventsSummaryDto> {
    const where = { scheduledDate: this.yearRange(year) };
    const today = new Date();

    const [events, completed, unsponsored] = await Promise.all([
      this.prisma.event.findMany({ where, select: { scheduledDate: true, isCompleted: true } }),
      this.prisma.event.count({ where: { ...where, isCompleted: true } }),
      this.prisma.event.count({ where: { ...where, sponsorId: null } }),
    ]);

    return {
      total: events.length,
      upcoming: events.filter(
        (event) =>
          !event.isCompleted &&
          event.scheduledDate.toISOString().slice(0, 10) >= today.toISOString().slice(0, 10),
      ).length,
      completed,
      unsponsored,
    };
  }

  /**
   * A year of one or more event types, slot by slot.
   *
   * Every planned instance appears whether or not it has been calendared yet,
   * which is what makes this a planning view rather than a list of what exists.
   */
  async schedule(
    year: number,
    canSeeContact: boolean,
    eventTypeId?: number,
  ): Promise<ScheduleGroupDto[]> {
    const types = await this.prisma.eventType.findMany({
      where: { id: eventTypeId },
      orderBy: { nameTa: 'asc' },
    });

    const ids = types.map((type) => type.id);

    const [sponsors, events] = await Promise.all([
      this.prisma.eventTypeSponsor.findMany({
        where: { eventTypeId: { in: ids } },
        include: { user: { select: SPONSOR_SELECT } },
      }),
      this.prisma.event.findMany({
        where: { eventTypeId: { in: ids }, scheduledDate: this.yearRange(year) },
        include: EVENT_INCLUDE,
      }),
    ]);

    const slotKey = (typeId: number, instance: number) => `${typeId}:${instance}`;

    // A slot can hold several dates in a year — a monthly type has one instance
    // and twelve occurrences — so the events are grouped rather than indexed,
    // and the earliest stands for the slot.
    const dated = new Map<string, typeof events>();

    for (const row of events) {
      const key = slotKey(row.eventTypeId, row.instanceIdentifier);
      const group = dated.get(key);

      if (group) group.push(row);
      else dated.set(key, [row]);
    }

    for (const group of dated.values()) {
      group.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
    }

    return types.map((type) => {
      // Sponsors registered against the type as a whole stand for every slot;
      // ones pinned to an instance are preferred where they exist.
      const typeWide = sponsors.filter(
        (row) => row.eventTypeId === type.id && row.instanceIdentifier === null,
      );

      const slots = Array.from({ length: type.noOfInstances }, (_, index) => {
        const instanceIdentifier = index + 1;
        const pinned = sponsors.filter(
          (row) => row.eventTypeId === type.id && row.instanceIdentifier === instanceIdentifier,
        );
        const candidates = [...pinned, ...typeWide];
        const assignment = candidates[0];
        const occurrences = dated.get(slotKey(type.id, instanceIdentifier)) ?? [];
        const event = occurrences[0];

        return {
          instanceIdentifier,
          instanceLabel: describeInstance(
            type.frequencyType,
            instanceIdentifier,
            pinned[0]?.customInstanceName ?? event?.customInstanceName,
          ),
          customInstanceName: pinned[0]?.customInstanceName ?? event?.customInstanceName ?? null,
          defaultSponsor: assignment ? this.toSponsor(assignment.user, canSeeContact) : null,
          sponsorCount: candidates.length,
          eventCount: occurrences.length,
          event: event ? this.toRecord(event, canSeeContact) : null,
        };
      });

      return {
        eventType: this.toEventType(type),
        slots,
        scheduledCount: slots.filter((slot) => slot.event !== null).length,
        sponsoredCount: slots.filter(
          (slot) => slot.defaultSponsor !== null || slot.event?.sponsorId,
        ).length,
      };
    });
  }

  /**
   * The next few occurrences, for the public website.
   *
   * Completed ones are excluded rather than filtered by date alone: an
   * occurrence somebody has already closed off is history, even if its date has
   * not passed in the visitor's timezone yet.
   */
  async publicUpcoming(limit = 6, today: Date = new Date()): Promise<PublicEventDto[]> {
    const events = await this.prisma.event.findMany({
      where: { scheduledDate: { gte: startOfUtcDay(today) }, isCompleted: false },
      include: PUBLIC_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
      take: limit,
    });

    return events.map((event) => this.toPublic(event));
  }

  /**
   * Every occurrence in a window, for the website's calendar.
   *
   * The window is capped so an anonymous caller cannot ask for the whole table
   * in one request; the site only ever paints a couple of years of months.
   */
  async publicCalendar(
    from?: string,
    to?: string,
    today: Date = new Date(),
  ): Promise<PublicEventDto[]> {
    const year = today.getUTCFullYear();

    const start = from ? new Date(from) : new Date(Date.UTC(year, 0, 1));
    const requestedEnd = to ? new Date(to) : new Date(Date.UTC(year + 2, 0, 1));
    const ceiling = new Date(
      Date.UTC(start.getUTCFullYear() + 3, start.getUTCMonth(), start.getUTCDate()),
    );

    const events = await this.prisma.event.findMany({
      where: {
        scheduledDate: { gte: start, lte: requestedEnd < ceiling ? requestedEnd : ceiling },
      },
      include: PUBLIC_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
    });

    return events.map((event) => this.toPublic(event));
  }

  async publicFindOneOrFail(id: number): Promise<PublicEventDto> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: PUBLIC_INCLUDE });

    if (!event) throw new NotFoundException(`Event ${id} was not found`);

    return this.toPublic(event);
  }

  async create(dto: CreateEventDto, context: ActorContext): Promise<EventRecordDto> {
    const type = await this.prisma.eventType.findUnique({ where: { id: dto.eventTypeId } });

    if (!type) throw new NotFoundException(`Event type ${dto.eventTypeId} was not found`);

    if (dto.instanceIdentifier > type.noOfInstances) {
      throw new BadRequestException(
        `${type.nameTa} has ${type.noOfInstances} instance(s); ${dto.instanceIdentifier} is out of range`,
      );
    }

    this.assertTimes(dto.startTime, dto.endTime);

    // An occurrence falls to its slot's registered sponsor unless one is named.
    const sponsorId =
      dto.sponsorId ?? (await this.standingSponsor(dto.eventTypeId, dto.instanceIdentifier));

    if (sponsorId) await this.assertSponsorIsActive(sponsorId);

    const event = await this.prisma.event.create({
      data: {
        eventTypeId: dto.eventTypeId,
        instanceIdentifier: dto.instanceIdentifier,
        customInstanceName: dto.customInstanceName,
        scheduledDate: new Date(dto.scheduledDate),
        startTime: timeToDate(dto.startTime),
        endTime: dto.endTime ? timeToDate(dto.endTime) : undefined,
        sponsorId,
        notes: dto.notes,
      },
      include: EVENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'event',
      entityRef: String(event.id),
      summary: `Calendared ${type.nameTa} instance ${dto.instanceIdentifier} for ${dto.scheduledDate}`,
    });

    return this.toRecord(event, true);
  }

  async update(id: number, dto: UpdateEventDto, context: ActorContext): Promise<EventRecordDto> {
    const before = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });

    if (!before) throw new NotFoundException(`Event ${id} was not found`);
    if (before.isCompleted) {
      throw new ConflictException('That occurrence is marked complete; reopen it before editing');
    }

    this.assertTimes(dto.startTime ?? dateToTime(before.startTime), dto.endTime);
    if (dto.sponsorId) await this.assertSponsorIsActive(dto.sponsorId);

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        customInstanceName: dto.customInstanceName,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        startTime: dto.startTime ? timeToDate(dto.startTime) : undefined,
        endTime: dto.endTime ? timeToDate(dto.endTime) : undefined,
        sponsorId: dto.sponsorId,
        notes: dto.notes,
      },
      include: EVENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event',
      entityRef: String(id),
      summary: `Updated ${event.eventType.nameTa} on ${event.scheduledDate.toISOString().slice(0, 10)}`,
      diff: AuditService.diff(
        { scheduledDate: before.scheduledDate, sponsorId: before.sponsorId, notes: before.notes },
        { scheduledDate: event.scheduledDate, sponsorId: event.sponsorId, notes: event.notes },
      ),
    });

    return this.toRecord(event, true);
  }

  async setCompleted(
    id: number,
    isCompleted: boolean,
    context: ActorContext,
  ): Promise<EventRecordDto> {
    const before = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });

    if (!before) throw new NotFoundException(`Event ${id} was not found`);
    if (before.isCompleted === isCompleted) return this.toRecord(before, true);

    if (isCompleted && before.scheduledDate > new Date()) {
      throw new BadRequestException('That occurrence has not happened yet');
    }

    const event = await this.prisma.event.update({
      where: { id },
      data: { isCompleted },
      include: EVENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event',
      entityRef: String(id),
      summary: `Marked ${event.eventType.nameTa} on ${event.scheduledDate.toISOString().slice(0, 10)} as ${isCompleted ? 'complete' : 'not complete'}`,
    });

    return this.toRecord(event, true);
  }

  async remove(id: number, context: ActorContext): Promise<void> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });

    if (!event) throw new NotFoundException(`Event ${id} was not found`);

    const vouchers = await this.prisma.voucher.count({ where: { eventId: id } });

    if (vouchers > 0) {
      throw new ConflictException(
        `${vouchers} voucher(s) reference this occurrence; it cannot be removed from the calendar`,
      );
    }

    await this.prisma.event.delete({ where: { id } });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'event',
      entityRef: String(id),
      summary: `Removed ${event.eventType.nameTa} on ${event.scheduledDate.toISOString().slice(0, 10)} from the calendar`,
    });
  }

  /**
   * The sponsor a new occurrence falls to when none is named.
   *
   * Only an unambiguous choice is filled in: a single sponsor pinned to this
   * instance. Once a slot has several, picking one for the user would be a
   * guess, so the occurrence is left unsponsored for someone to decide.
   */
  private async standingSponsor(
    eventTypeId: number,
    instanceIdentifier: number,
  ): Promise<string | undefined> {
    const pinned = await this.prisma.eventTypeSponsor.findMany({
      where: { eventTypeId, instanceIdentifier },
      select: { userId: true },
      take: 2,
    });

    return pinned.length === 1 ? pinned[0].userId : undefined;
  }

  private async assertSponsorIsActive(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user) throw new NotFoundException(`User ${userId} was not found`);
    if (!user.isActive) throw new BadRequestException('That account is deactivated');
  }

  private assertTimes(startTime: string, endTime?: string): void {
    if (endTime && endTime <= startTime) {
      throw new BadRequestException('An event must end after it starts');
    }
  }

  private dateRange(query: QueryEventsDto): Prisma.DateTimeFilter | undefined {
    if (query.year) return this.yearRange(query.year);
    if (!query.from && !query.to) return undefined;

    return {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined,
    };
  }

  private yearRange(year: number): Prisma.DateTimeFilter {
    return { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
  }

  private toEventType(type: EventRow['eventType']) {
    return {
      id: type.id,
      name: type.nameTa,
      nameEn: type.nameEn ?? '',
      frequencyType: type.frequencyType,
      noOfInstances: type.noOfInstances,
      createdAt: type.createdAt,
      updatedAt: type.updatedAt,
    };
  }

  private toSponsor(row: SponsorRow, canSeeContact: boolean): SponsorUserDto {
    return {
      id: row.id,
      fullName: row.fullName ?? row.nameTa,
      email: canSeeContact ? row.email : null,
      phone: canSeeContact ? row.phone : null,
      address: row.address,
    };
  }

  private toPublic(event: PublicEventRow): PublicEventDto {
    return {
      id: event.id,
      eventTypeId: event.eventTypeId,
      nameTa: event.eventType.nameTa,
      nameEn: event.eventType.nameEn ?? event.eventType.nameTa,
      frequencyType: event.eventType.frequencyType,
      instanceIdentifier: event.instanceIdentifier,
      customInstanceName: event.customInstanceName,
      scheduledDate: event.scheduledDate.toISOString().slice(0, 10),
      startTime: dateToTime(event.startTime),
      endTime: event.endTime ? dateToTime(event.endTime) : null,
      sponsorNameTa: event.sponsor?.nameTa ?? null,
      sponsorNameEn: event.sponsor ? (event.sponsor.fullName ?? event.sponsor.nameTa) : null,
      notes: event.notes,
      isCompleted: event.isCompleted,
    };
  }

  private toRecord(event: EventRow, canSeeContact: boolean): EventRecordDto {
    return {
      id: event.id,
      eventTypeId: event.eventTypeId,
      instanceIdentifier: event.instanceIdentifier,
      customInstanceName: event.customInstanceName,
      scheduledDate: event.scheduledDate.toISOString().slice(0, 10),
      startTime: dateToTime(event.startTime),
      endTime: event.endTime ? dateToTime(event.endTime) : null,
      sponsorId: event.sponsorId,
      notes: event.notes,
      isCompleted: event.isCompleted,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      eventType: this.toEventType(event.eventType),
      sponsor: event.sponsor ? this.toSponsor(event.sponsor, canSeeContact) : null,
      instanceLabel: describeInstance(
        event.eventType.frequencyType,
        event.instanceIdentifier,
        event.customInstanceName,
      ),
      status: deriveEventStatus(event.scheduledDate, event.isCompleted),
      isOverdue: isOverdue(event.scheduledDate, event.isCompleted),
    };
  }
}
