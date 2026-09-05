import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { describeInstance } from '../sponsors/instance-label';
import {
  CreateEventTypeDto,
  EventSlotDto,
  UpdateEventSlotDto,
  EventTypeRecordDto,
  QueryEventTypesDto,
  UpdateEventTypeDto,
} from './dto/event-type.dto';

type EventTypeRow = Prisma.EventTypeGetPayload<Record<string, never>>;

@Injectable()
export class EventTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryEventTypesDto): Promise<EventTypeRecordDto[]> {
    const year = query.year ?? new Date().getFullYear();

    const types = await this.prisma.eventType.findMany({
      where: {
        frequencyType: query.frequencyType,
        OR: query.search
          ? [
              { nameTa: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      orderBy: { nameTa: 'asc' },
    });

    const [sponsors, scheduled] = await Promise.all([
      // A sponsorship names its type directly, placed or not, so the count
      // includes the people registered for the type but not yet given a slot.
      this.prisma.eventTypeSponsor.findMany({
        select: { eventTypeId: true },
      }),
      // Events reach their type through a slot, so they are counted by slot
      // and rolled up rather than grouped on a column that no longer exists.
      this.prisma.event.findMany({
        where: this.withinYear(year),
        select: { slot: { select: { eventTypeId: true } } },
      }),
    ]);

    const sponsorCount = new Map<number, number>();

    for (const row of sponsors) {
      sponsorCount.set(row.eventTypeId, (sponsorCount.get(row.eventTypeId) ?? 0) + 1);
    }
    const eventCount = new Map<number, number>();

    for (const row of scheduled) {
      eventCount.set(row.slot.eventTypeId, (eventCount.get(row.slot.eventTypeId) ?? 0) + 1);
    }

    return types.map((type) =>
      this.toRecord(type, sponsorCount.get(type.id) ?? 0, eventCount.get(type.id) ?? 0),
    );
  }

  async findOneOrFail(id: number, year = new Date().getFullYear()): Promise<EventTypeRecordDto> {
    const type = await this.prisma.eventType.findUnique({ where: { id } });

    if (!type) throw new NotFoundException(`Event type ${id} was not found`);

    const [sponsorSlots, scheduledCount] = await Promise.all([
      this.prisma.eventTypeSponsor.count({ where: { eventTypeId: id } }),
      this.prisma.event.count({ where: { slot: { eventTypeId: id }, ...this.withinYear(year) } }),
    ]);

    return this.toRecord(type, sponsorSlots, scheduledCount);
  }

  /**
   * A type's slots — the fixed structure of its year.
   *
   * The one screen where the shape of a pooja can be set out before any date
   * exists: name the slot, see who takes it, see whether it has been scheduled.
   */
  async slots(eventTypeId: number, year = new Date().getFullYear()): Promise<EventSlotDto[]> {
    const type = await this.prisma.eventType.findUnique({ where: { id: eventTypeId } });

    if (!type) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    const slots = await this.prisma.eventSlot.findMany({
      where: { eventTypeId },
      orderBy: { instanceIdentifier: 'asc' },
      include: {
        sponsors: { include: { party: { select: { nameTa: true } } } },
        events: { where: this.withinYear(year), select: { id: true } },
      },
    });

    return slots.map((slot) => ({
      id: slot.id,
      instanceIdentifier: slot.instanceIdentifier,
      customInstanceName: slot.customInstanceName,
      instanceLabel: describeInstance(
        type.frequencyType,
        slot.instanceIdentifier,
        slot.customInstanceName,
      ),
      isActive: slot.isActive,
      sponsorNames: slot.sponsors.map((row) => row.party.nameTa),
      scheduledCount: slot.events.length,
    }));
  }

  async updateSlot(
    slotId: number,
    dto: UpdateEventSlotDto,
    context: ActorContext,
  ): Promise<EventSlotDto> {
    const before = await this.prisma.eventSlot.findUnique({
      where: { id: slotId },
      include: { eventType: true },
    });

    if (!before) throw new NotFoundException(`Slot ${slotId} was not found`);

    const slot = await this.prisma.eventSlot.update({
      where: { id: slotId },
      data: {
        customInstanceName:
          dto.customInstanceName === undefined ? undefined : dto.customInstanceName || null,
        isActive: dto.isActive,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_slot',
      entityRef: String(slotId),
      summary: `Renamed ${before.eventType.nameTa} instance ${slot.instanceIdentifier} to ${slot.customInstanceName ?? '(no name)'}`,
    });

    const [refreshed] = await this.slots(before.eventTypeId);

    return (await this.slots(before.eventTypeId)).find((row) => row.id === slotId) ?? refreshed;
  }

  async create(dto: CreateEventTypeDto, context: ActorContext): Promise<EventTypeRecordDto> {
    await this.assertActivityIsUsable(dto.activityId ?? null);

    /*
     * A type's slots come into being with it. They are the structure of the
     * temple year — the rows sponsors attach to and occurrences are dated
     * against — so a type without them could never be scheduled.
     */
    const type = await this.prisma.eventType.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        frequencyType: dto.frequencyType,
        noOfInstances: dto.noOfInstances,
        activityId: dto.activityId ?? null,
        slots: {
          create: Array.from({ length: dto.noOfInstances }, (_, index) => ({
            instanceIdentifier: index + 1,
          })),
        },
      },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'event_type',
      entityRef: String(type.id),
      summary: `Added event type ${type.nameTa} (${type.frequencyType}, ${type.noOfInstances} instance(s))`,
    });

    return this.findOneOrFail(type.id);
  }

  async update(
    id: number,
    dto: UpdateEventTypeDto,
    context: ActorContext,
  ): Promise<EventTypeRecordDto> {
    const before = await this.prisma.eventType.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Event type ${id} was not found`);

    if (dto.noOfInstances !== undefined && dto.noOfInstances < before.noOfInstances) {
      await this.assertNoSlotsBeyond(id, dto.noOfInstances);
    }

    const activityId = dto.activityId === undefined ? before.activityId : (dto.activityId ?? null);

    await this.assertActivityIsUsable(activityId);

    const type = await this.prisma.eventType.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        frequencyType: dto.frequencyType,
        noOfInstances: dto.noOfInstances,
        activityId,
      },
    });

    // The slots follow the count: a longer year gains them, a shorter one
    // loses the surplus — and only ever after assertNoSlotsBeyond has proved
    // nothing is standing on the ones about to go.
    if (dto.noOfInstances !== undefined && dto.noOfInstances !== before.noOfInstances) {
      await this.syncSlots(id, dto.noOfInstances);
    }

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_type',
      entityRef: String(id),
      summary: `Updated event type ${type.nameTa}`,
      diff: AuditService.diff(before, type),
    });

    return this.findOneOrFail(id);
  }

  async remove(id: number, context: ActorContext): Promise<void> {
    const type = await this.prisma.eventType.findUnique({ where: { id } });

    if (!type) throw new NotFoundException(`Event type ${id} was not found`);

    const [events, vouchers] = await Promise.all([
      this.prisma.event.count({ where: { slot: { eventTypeId: id } } }),
      // A voucher reaches a pooja type through the occurrence on its lines.
      this.prisma.voucherLine.count({ where: { event: { slot: { eventTypeId: id } } } }),
    ]);

    if (events > 0 || vouchers > 0) {
      throw new ConflictException(
        `${type.nameTa} has ${events} calendared occurrence(s) and ${vouchers} voucher(s); its history cannot be removed`,
      );
    }

    await this.prisma.eventType.delete({ where: { id } });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'event_type',
      entityRef: String(id),
      summary: `Removed event type ${type.nameTa}`,
    });
  }

  /**
   * A default is a suggestion, but a wrong one is worse than none: it would put
   * every receipt for the pooja against a project in the wrong fund, quietly.
   */
  /** The activity carries the fund in turn, so only the activity is checked. */
  private async assertActivityIsUsable(activityId: number | null): Promise<void> {
    if (activityId === null) return;

    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });

    if (!activity) throw new NotFoundException(`Activity ${activityId} was not found`);

    if (!activity.isActive) {
      throw new ConflictException(`${activity.nameTa} is no longer an active activity`);
    }
  }

  private async syncSlots(eventTypeId: number, noOfInstances: number): Promise<void> {
    await this.prisma.eventSlot.deleteMany({
      where: { eventTypeId, instanceIdentifier: { gt: noOfInstances } },
    });

    const existing = await this.prisma.eventSlot.findMany({
      where: { eventTypeId },
      select: { instanceIdentifier: true },
    });

    const held = new Set(existing.map((slot) => slot.instanceIdentifier));

    const missing = Array.from({ length: noOfInstances }, (_, index) => index + 1).filter(
      (instanceIdentifier) => !held.has(instanceIdentifier),
    );

    if (missing.length === 0) return;

    await this.prisma.eventSlot.createMany({
      data: missing.map((instanceIdentifier) => ({ eventTypeId, instanceIdentifier })),
      skipDuplicates: true,
    });
  }

  /** Shrinking a year would orphan sponsors and events sitting on the lost slots. */
  private async assertNoSlotsBeyond(id: number, noOfInstances: number): Promise<void> {
    const [sponsors, events] = await Promise.all([
      this.prisma.eventTypeSponsor.count({
        where: { slot: { eventTypeId: id, instanceIdentifier: { gt: noOfInstances } } },
      }),
      this.prisma.event.count({
        where: { slot: { eventTypeId: id, instanceIdentifier: { gt: noOfInstances } } },
      }),
    ]);

    if (sponsors > 0 || events > 0) {
      throw new ConflictException(
        `Instances beyond ${noOfInstances} still carry ${sponsors} sponsor(s) and ${events} occurrence(s)`,
      );
    }
  }

  private withinYear(year: number): Prisma.EventWhereInput {
    return {
      scheduledDate: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    };
  }

  private toRecord(
    type: EventTypeRow,
    sponsorSlots: number,
    scheduledCount: number,
  ): EventTypeRecordDto {
    return {
      id: type.id,
      name: type.nameTa,
      nameEn: type.nameEn ?? '',
      frequencyType: type.frequencyType,
      noOfInstances: type.noOfInstances,
      activityId: type.activityId,
      createdAt: type.createdAt,
      updatedAt: type.updatedAt,
      sponsorSlots,
      scheduledCount,
    };
  }
}
