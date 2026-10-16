import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { PartyKind, VoucherStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { describeInstance } from '../sponsors/instance-label';
import { SponsorPartyDto } from '../sponsors/dto/sponsor.dto';
import {
  ContributorDto,
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
  nameEn: true,
  phone: true,
  email: true,
  address: true,
  account: { select: { id: true } },
  sponsor: { select: { sponsorNo: true } },
} satisfies Prisma.PartySelect;

const EVENT_INCLUDE = {
  slot: { include: { eventType: true } },
  sponsor: { select: SPONSOR_SELECT },
} satisfies Prisma.EventInclude;

// Public responses expose only the sponsor's name; contact details never leave the API.
const PUBLIC_INCLUDE = {
  slot: { include: { eventType: true } },
  sponsor: { select: { nameTa: true, nameEn: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;
type PublicEventRow = Prisma.EventGetPayload<{ include: typeof PUBLIC_INCLUDE }>;
type SponsorRow = Prisma.PartyGetPayload<{ select: typeof SPONSOR_SELECT }>;

// Postgres `time` has no date, so HH:mm is stored on an arbitrary day.
const timeToDate = (value: string): Date => new Date(`1970-01-01T${value}:00Z`);
const dateToTime = (value: Date): string => value.toISOString().slice(11, 16);

// scheduled_date is a Postgres `date`, which compares against UTC midnight.
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
        slot: query.eventTypeId ? { eventTypeId: query.eventTypeId } : undefined,
        isCompleted: query.isCompleted,
        sponsorPartyId: query.unsponsoredOnly ? null : undefined,
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

  // Contributors are computed from past gifts to the same slot, then sponsors, vendors and devotees follow.
  async contributors(eventId: number, canSeeContact: boolean): Promise<ContributorDto[]> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, slotId: true },
    });

    if (!event) throw new NotFoundException(`Event ${eventId} was not found`);

    const [gave, alreadyGiven, roles] = await Promise.all([
      // Read from voucher lines, not the ledger, so draft receipts don't count as money received.
      this.prisma.voucherLine.findMany({
        where: {
          event: { slotId: event.slotId, id: { not: eventId } },
          voucher: { status: VoucherStatus.Posted, partyId: { not: null } },
        },
        select: {
          amount: true,
          voucher: { select: { partyId: true, date: true } },
        },
      }),
      this.prisma.voucherLine.findMany({
        where: {
          eventId,
          voucher: { status: { not: VoucherStatus.Cancelled }, partyId: { not: null } },
        },
        select: { amount: true, voucher: { select: { partyId: true } } },
      }),
      this.prisma.party.findMany({
        where: {
          isActive: true,
          OR: [{ sponsor: { isNot: null } }, { roles: { some: {} } }],
        },
        select: {
          id: true,
          nameTa: true,
          nameEn: true,
          phone: true,
          roles: { select: { kind: true } },
          sponsor: { select: { partyId: true } },
        },
        orderBy: { nameTa: 'asc' },
      }),
    ]);

    const paid = new Map<number, number>();
    for (const line of alreadyGiven) {
      const partyId = line.voucher.partyId!;
      paid.set(partyId, (paid.get(partyId) ?? 0) + toRupees(line.amount));
    }

    // Most recent gift, which is the figure to prefill.
    const history = new Map<number, { amount: number; year: number }>();
    for (const line of gave) {
      const partyId = line.voucher.partyId!;
      const year = line.voucher.date.getUTCFullYear();
      const previous = history.get(partyId);

      if (!previous || year > previous.year) {
        history.set(partyId, { amount: toRupees(line.amount), year });
      }
    }

    const byId = new Map(roles.map((party) => [party.id, party]));

    // Past contributors stay on the sheet even without a current role.
    const missing = [...history.keys()].filter((id) => !byId.has(id));

    if (missing.length > 0) {
      const extra = await this.prisma.party.findMany({
        where: { id: { in: missing } },
        select: {
          id: true,
          nameTa: true,
          nameEn: true,
          phone: true,
          roles: { select: { kind: true } },
          sponsor: { select: { partyId: true } },
        },
      });

      for (const party of extra) byId.set(party.id, party);
    }

    const rows = [...byId.values()].map((party) => {
      const previous = history.get(party.id);
      const reason: ContributorDto['reason'] = previous
        ? 'gave-before'
        : party.sponsor
          ? 'sponsor'
          : party.roles.some((role) => role.kind === PartyKind.vendor)
            ? 'vendor'
            : 'devotee';

      return {
        partyId: party.id,
        name: party.nameTa,
        nameEn: party.nameEn,
        phone: canSeeContact ? party.phone : null,
        reason,
        lastAmount: previous?.amount ?? null,
        lastYear: previous?.year ?? null,
        paidThisTime: paid.has(party.id),
        paidAmount: paid.get(party.id) ?? null,
      };
    });

    // Past contributors first by amount, then everyone else by name.
    const ORDER: Record<ContributorDto['reason'], number> = {
      'gave-before': 0,
      sponsor: 1,
      vendor: 2,
      devotee: 3,
    };

    return rows.sort(
      (a, b) =>
        ORDER[a.reason] - ORDER[b.reason] ||
        (b.lastAmount ?? 0) - (a.lastAmount ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }

  async summary(year = new Date().getFullYear()): Promise<EventsSummaryDto> {
    const where = { scheduledDate: this.yearRange(year) };
    const today = new Date();

    const [events, completed, unsponsored] = await Promise.all([
      this.prisma.event.findMany({ where, select: { scheduledDate: true, isCompleted: true } }),
      this.prisma.event.count({ where: { ...where, isCompleted: true } }),
      this.prisma.event.count({ where: { ...where, sponsorPartyId: null } }),
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

  // Includes every planned slot, scheduled or not.
  async schedule(
    year: number,
    canSeeContact: boolean,
    eventTypeId?: number,
  ): Promise<ScheduleGroupDto[]> {
    const types = await this.prisma.eventType.findMany({
      where: { id: eventTypeId },
      orderBy: { nameTa: 'asc' },
      include: { slots: { orderBy: { instanceIdentifier: 'asc' } } },
    });

    const ids = types.map((type) => type.id);

    const [sponsors, events] = await Promise.all([
      // Gathered by event type, then matched to each slot below.
      this.prisma.eventTypeSponsor.findMany({
        where: { slot: { eventTypeId: { in: ids } } },
        include: { party: { select: SPONSOR_SELECT } },
      }),
      this.prisma.event.findMany({
        where: { slot: { eventTypeId: { in: ids } }, scheduledDate: this.yearRange(year) },
        include: EVENT_INCLUDE,
      }),
    ]);

    // A slot can have several dates a year (monthly poojas), so group them; the earliest represents the slot.
    const dated = new Map<number, typeof events>();

    for (const row of events) {
      const group = dated.get(row.slotId);

      if (group) group.push(row);
      else dated.set(row.slotId, [row]);
    }

    for (const group of dated.values()) {
      group.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
    }

    return types.map((type) => {
      const slots = type.slots.map((slot) => {
        const candidates = sponsors.filter((row) => row.slotId === slot.id);
        const occurrences = dated.get(slot.id) ?? [];
        const event = occurrences[0];

        return {
          slotId: slot.id,
          instanceIdentifier: slot.instanceIdentifier,
          instanceLabel: describeInstance(
            type.frequencyType,
            slot.instanceIdentifier,
            slot.customInstanceName,
          ),
          customInstanceName: slot.customInstanceName,
          sponsors: candidates.map((row) => this.toSponsor(row.party, canSeeContact)),
          defaultSponsor: candidates[0] ? this.toSponsor(candidates[0].party, canSeeContact) : null,
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
          (slot) => slot.defaultSponsor !== null || slot.event?.sponsorPartyId,
        ).length,
      };
    });
  }

  // Excludes completed occurrences even if their date hasn't passed yet.
  async publicUpcoming(limit = 6, today: Date = new Date()): Promise<PublicEventDto[]> {
    const events = await this.prisma.event.findMany({
      where: { scheduledDate: { gte: startOfUtcDay(today) }, isCompleted: false },
      include: PUBLIC_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { startTime: 'asc' }],
      take: limit,
    });

    return events.map((event) => this.toPublic(event));
  }

  // The window is capped so an anonymous caller can't request the whole table.
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
    const slot = await this.resolveSlot(dto.eventTypeId, dto.instanceIdentifier);
    const type = slot.eventType;

    this.assertTimes(dto.startTime, dto.endTime);
    await this.assertFreeThatYear(slot.id, new Date(dto.scheduledDate));

    // Defaults to the slot's registered sponsor unless one is named.
    const sponsorPartyId = dto.sponsorPartyId ?? (await this.standingSponsor(slot.id));

    if (sponsorPartyId) await this.assertSponsorIsUsable(sponsorPartyId);

    const event = await this.prisma.event.create({
      data: {
        slotId: slot.id,
        scheduledDate: new Date(dto.scheduledDate),
        startTime: timeToDate(dto.startTime),
        endTime: dto.endTime ? timeToDate(dto.endTime) : undefined,
        sponsorPartyId,
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

    if (dto.scheduledDate) {
      await this.assertFreeThatYear(before.slotId, new Date(dto.scheduledDate), id);
    }

    if (dto.sponsorPartyId) await this.assertSponsorIsUsable(dto.sponsorPartyId);

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        startTime: dto.startTime ? timeToDate(dto.startTime) : undefined,
        endTime: dto.endTime ? timeToDate(dto.endTime) : undefined,
        sponsorPartyId: dto.sponsorPartyId,
        notes: dto.notes,
      },
      include: EVENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event',
      entityRef: String(id),
      summary: `Updated ${event.slot.eventType.nameTa} on ${event.scheduledDate.toISOString().slice(0, 10)}`,
      diff: AuditService.diff(
        {
          scheduledDate: before.scheduledDate,
          sponsorPartyId: before.sponsorPartyId,
          notes: before.notes,
        },
        {
          scheduledDate: event.scheduledDate,
          sponsorPartyId: event.sponsorPartyId,
          notes: event.notes,
        },
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
      summary: `Marked ${event.slot.eventType.nameTa} on ${event.scheduledDate.toISOString().slice(0, 10)} as ${isCompleted ? 'complete' : 'not complete'}`,
    });

    return this.toRecord(event, true);
  }

  async remove(id: number, context: ActorContext): Promise<void> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });

    if (!event) throw new NotFoundException(`Event ${id} was not found`);

    const vouchers = await this.prisma.voucherLine.count({ where: { eventId: id } });

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
      summary: `Removed ${event.slot.eventType.nameTa} on ${event.scheduledDate.toISOString().slice(0, 10)} from the calendar`,
    });
  }

  // Only defaults when the slot has exactly one sponsor; with several, someone must choose.
  private async standingSponsor(slotId: number): Promise<number | undefined> {
    const pinned = await this.prisma.eventTypeSponsor.findMany({
      where: { slotId },
      select: { partyId: true },
      take: 2,
    });

    return pinned.length === 1 ? pinned[0].partyId : undefined;
  }

  private async assertSponsorIsUsable(partyId: number): Promise<void> {
    const party = await this.prisma.party.findUnique({
      where: { id: partyId },
      select: { isActive: true, nameTa: true },
    });

    if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
    if (!party.isActive) throw new BadRequestException(`${party.nameTa} is retired`);
  }

  // Writes name a type and instance number; this resolves the slot and rejects undeclared instances.
  private async resolveSlot(eventTypeId: number, instanceIdentifier: number) {
    const slot = await this.prisma.eventSlot.findUnique({
      where: {
        eventTypeId_instanceIdentifier: { eventTypeId, instanceIdentifier },
      },
      include: { eventType: true },
    });

    if (!slot) {
      const type = await this.prisma.eventType.findUnique({ where: { id: eventTypeId } });

      if (!type) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

      throw new BadRequestException(
        `${type.nameTa} has ${type.noOfInstances} instance(s); ${instanceIdentifier} is out of range`,
      );
    }

    if (!slot.isActive) {
      throw new ConflictException(`That instance of ${slot.eventType.nameTa} is retired`);
    }

    return slot;
  }

  // The DB allows one occurrence per slot per year; this names the existing one in the error.
  private async assertFreeThatYear(
    slotId: number,
    scheduledDate: Date,
    exceptId?: number,
  ): Promise<void> {
    const year = scheduledDate.getUTCFullYear();

    const existing = await this.prisma.event.findFirst({
      where: {
        slotId,
        id: exceptId ? { not: exceptId } : undefined,
        scheduledDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      include: { slot: { include: { eventType: true } } },
    });

    if (!existing) return;

    throw new ConflictException(
      `${existing.slot.eventType.nameTa} instance ${existing.slot.instanceIdentifier} is already set out for ${year}, on ${existing.scheduledDate.toISOString().slice(0, 10)}`,
    );
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

  private toEventType(type: EventRow['slot']['eventType']) {
    return {
      id: type.id,
      name: type.nameTa,
      nameEn: type.nameEn ?? '',
      frequencyType: type.frequencyType,
      funding: type.funding,
      noOfInstances: type.noOfInstances,
      activityId: type.activityId,
      createdAt: type.createdAt,
      updatedAt: type.updatedAt,
    };
  }

  private toSponsor(row: SponsorRow, canSeeContact: boolean): SponsorPartyDto {
    return {
      id: row.id,
      name: row.nameTa,
      nameEn: row.nameEn ?? '',
      email: canSeeContact ? row.email : null,
      phone: canSeeContact ? row.phone : null,
      address: row.address ?? '',
      sponsorNo: row.sponsor?.sponsorNo ?? null,
      accountId: row.account?.id ?? null,
    };
  }

  private toPublic(event: PublicEventRow): PublicEventDto {
    return {
      id: event.id,
      eventTypeId: event.slot.eventTypeId,
      nameTa: event.slot.eventType.nameTa,
      nameEn: event.slot.eventType.nameEn ?? event.slot.eventType.nameTa,
      frequencyType: event.slot.eventType.frequencyType,
      instanceIdentifier: event.slot.instanceIdentifier,
      customInstanceName: event.slot.customInstanceName,
      scheduledDate: event.scheduledDate.toISOString().slice(0, 10),
      startTime: dateToTime(event.startTime),
      endTime: event.endTime ? dateToTime(event.endTime) : null,
      sponsorNameTa: event.sponsor?.nameTa ?? null,
      sponsorNameEn: event.sponsor ? (event.sponsor.nameEn ?? event.sponsor.nameTa) : null,
      notes: event.notes,
      isCompleted: event.isCompleted,
    };
  }

  private toRecord(event: EventRow, canSeeContact: boolean): EventRecordDto {
    return {
      id: event.id,
      eventTypeId: event.slot.eventTypeId,
      instanceIdentifier: event.slot.instanceIdentifier,
      customInstanceName: event.slot.customInstanceName,
      scheduledDate: event.scheduledDate.toISOString().slice(0, 10),
      startTime: dateToTime(event.startTime),
      endTime: event.endTime ? dateToTime(event.endTime) : null,
      sponsorPartyId: event.sponsorPartyId,
      notes: event.notes,
      isCompleted: event.isCompleted,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      eventType: this.toEventType(event.slot.eventType),
      sponsor: event.sponsor ? this.toSponsor(event.sponsor, canSeeContact) : null,
      instanceLabel: describeInstance(
        event.slot.eventType.frequencyType,
        event.slot.instanceIdentifier,
        event.slot.customInstanceName,
      ),
      status: deriveEventStatus(event.scheduledDate, event.isCompleted),
      isOverdue: isOverdue(event.scheduledDate, event.isCompleted),
    };
  }
}
