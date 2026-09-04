import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateEventTypeDto,
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
      this.prisma.eventTypeSponsor.groupBy({ by: ['eventTypeId'], _count: { _all: true } }),
      this.prisma.event.groupBy({
        by: ['eventTypeId'],
        where: this.withinYear(year),
        _count: { _all: true },
      }),
    ]);

    const sponsorCount = new Map(sponsors.map((row) => [row.eventTypeId, row._count._all]));
    const eventCount = new Map(scheduled.map((row) => [row.eventTypeId, row._count._all]));

    return types.map((type) =>
      this.toRecord(type, sponsorCount.get(type.id) ?? 0, eventCount.get(type.id) ?? 0),
    );
  }

  async findOneOrFail(id: number, year = new Date().getFullYear()): Promise<EventTypeRecordDto> {
    const type = await this.prisma.eventType.findUnique({ where: { id } });

    if (!type) throw new NotFoundException(`Event type ${id} was not found`);

    const [sponsorSlots, scheduledCount] = await Promise.all([
      this.prisma.eventTypeSponsor.count({ where: { eventTypeId: id } }),
      this.prisma.event.count({ where: { eventTypeId: id, ...this.withinYear(year) } }),
    ]);

    return this.toRecord(type, sponsorSlots, scheduledCount);
  }

  async create(dto: CreateEventTypeDto, context: ActorContext): Promise<EventTypeRecordDto> {
    await this.assertDefaultCoding(dto.defaultFundId ?? null, dto.defaultProjectId ?? null);

    const type = await this.prisma.eventType.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        frequencyType: dto.frequencyType,
        noOfInstances: dto.noOfInstances,
        defaultFundId: dto.defaultFundId ?? null,
        defaultProjectId: dto.defaultProjectId ?? null,
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

    /*
     * Validated against what the row will hold, not what the request carried:
     * moving the fund alone must still be checked against the project already
     * on the type, or the pair could be left pointing at different funds.
     */
    const defaultFundId =
      dto.defaultFundId === undefined ? before.defaultFundId : (dto.defaultFundId ?? null);
    const defaultProjectId =
      dto.defaultProjectId === undefined ? before.defaultProjectId : (dto.defaultProjectId ?? null);

    await this.assertDefaultCoding(defaultFundId, defaultProjectId);

    const type = await this.prisma.eventType.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        frequencyType: dto.frequencyType,
        noOfInstances: dto.noOfInstances,
        defaultFundId,
        defaultProjectId,
      },
    });

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
      this.prisma.event.count({ where: { eventTypeId: id } }),
      this.prisma.voucher.count({ where: { eventTypeId: id } }),
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
  private async assertDefaultCoding(
    fundId: number | null,
    projectId: number | null,
  ): Promise<void> {
    if (fundId !== null) {
      const fund = await this.prisma.fund.findUnique({ where: { id: fundId } });

      if (!fund) throw new NotFoundException(`Fund ${fundId} was not found`);
      if (!fund.isActive) throw new ConflictException(`Fund ${fund.nameTa} is closed`);
    }

    if (projectId === null) return;

    if (fundId === null) {
      throw new ConflictException('A default project needs the fund it is carried in');
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });

    if (!project) throw new NotFoundException(`Project ${projectId} was not found`);

    if (project.fundId !== fundId) {
      throw new ConflictException(`${project.nameTa} is not carried in the fund chosen above`);
    }
  }

  /** Shrinking a year would orphan sponsors and events sitting on the lost slots. */
  private async assertNoSlotsBeyond(id: number, noOfInstances: number): Promise<void> {
    const [sponsors, events] = await Promise.all([
      this.prisma.eventTypeSponsor.count({
        where: { eventTypeId: id, instanceIdentifier: { gt: noOfInstances } },
      }),
      this.prisma.event.count({
        where: { eventTypeId: id, instanceIdentifier: { gt: noOfInstances } },
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
      defaultFundId: type.defaultFundId,
      defaultProjectId: type.defaultProjectId,
      createdAt: type.createdAt,
      updatedAt: type.updatedAt,
      sponsorSlots,
      scheduledCount,
    };
  }
}
