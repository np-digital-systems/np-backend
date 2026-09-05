import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PartyKind } from '../../generated/prisma/enums';
import {
  CreateSponsorDto,
  QueryDirectoryDto,
  QuerySponsorsDto,
  SponsorAssignmentDto,
  SponsorPartyDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import { describeInstance } from './instance-label';

/*
 * Email and address live on the sign-in rather than the party, so they are
 * read through the link where there is one. A sponsor who never signs in has
 * a name and a phone number, which is all the temple ever had for them.
 */
const SPONSOR_SELECT = {
  id: true,
  nameTa: true,
  nameEn: true,
  phone: true,
  userId: true,
  user: { select: { email: true, address: true } },
} satisfies Prisma.PartySelect;

type SponsorRow = Prisma.PartyGetPayload<{ select: typeof SPONSOR_SELECT }>;

const ASSIGNMENT_INCLUDE = {
  eventType: true,
  party: { select: SPONSOR_SELECT },
} satisfies Prisma.EventTypeSponsorInclude;

type AssignmentRow = Prisma.EventTypeSponsorGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

/** Occurrence counts, keyed by slot for instance rows and by type for the rest. */
interface OccurrenceCounts {
  bySlot: Map<string, number>;
  byType: Map<number, number>;
}

const NO_OCCURRENCES: OccurrenceCounts = { bySlot: new Map(), byType: new Map() };

@Injectable()
export class SponsorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everyone who could be registered as a sponsor.
   *
   * Unfiltered by role on purpose. A florist the temple has only ever bought
   * flowers from may sponsor a pooja next Friday, and should be findable
   * without being re-registered as a second party — the act of registering
   * them grants the role.
   */
  async directory(
    query: QueryDirectoryDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SponsorPartyDto>> {
    const where: Prisma.PartyWhereInput = {
      isActive: true,
      roles: query.kind ? { some: { kind: query.kind } } : undefined,
      OR: query.search
        ? [
            { nameTa: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.party.findMany({
        where,
        select: SPONSOR_SELECT,
        orderBy: { nameTa: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.party.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => this.toSponsor(row, canSeeContact)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  /**
   * Sponsors registered against an event type.
   *
   * Narrowing by instance keeps the type-wide sponsors (null instance) in the
   * result — they stand for every slot, so they are candidates for this one too.
   */
  async findMany(query: QuerySponsorsDto, canSeeContact: boolean): Promise<SponsorAssignmentDto[]> {
    const year = query.year ?? new Date().getFullYear();

    const assignments = await this.prisma.eventTypeSponsor.findMany({
      where: {
        eventTypeId: query.eventTypeId,
        ...(query.instanceIdentifier === undefined
          ? {}
          : {
              OR: [{ instanceIdentifier: query.instanceIdentifier }, { instanceIdentifier: null }],
            }),
      },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ eventTypeId: 'asc' }, { instanceIdentifier: { sort: 'asc', nulls: 'first' } }],
    });

    const occurrences = await this.countOccurrences(assignments, year);

    return assignments.map((assignment) =>
      this.toAssignment(assignment, occurrences, canSeeContact),
    );
  }

  async findOne(id: number, canSeeContact: boolean): Promise<SponsorAssignmentDto> {
    const assignment = await this.prisma.eventTypeSponsor.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });

    if (!assignment) throw new NotFoundException(`Sponsor ${id} was not found`);

    const occurrences = await this.countOccurrences([assignment], new Date().getFullYear());

    return this.toAssignment(assignment, occurrences, canSeeContact);
  }

  async create(dto: CreateSponsorDto, context: ActorContext): Promise<SponsorAssignmentDto> {
    await this.assertSlotExists(dto.eventTypeId, dto.instanceIdentifier);
    await this.assertPartyIsUsable(dto.partyId);
    await this.assertNotDuplicate(dto.eventTypeId, dto.instanceIdentifier ?? null, dto.partyId);

    const created = await this.prisma.$transaction(async (tx) => {
      // Sponsoring something is what makes a party a sponsor. Granting the role
      // here is what lets the picker offer the temple's florist for next
      // Friday's pooja without anyone registering them a second time.
      await tx.partyRole.createMany({
        data: [{ partyId: dto.partyId, kind: PartyKind.sponsor }],
        skipDuplicates: true,
      });

      return tx.eventTypeSponsor.create({
        data: {
          eventTypeId: dto.eventTypeId,
          instanceIdentifier: dto.instanceIdentifier ?? null,
          customInstanceName: dto.customInstanceName,
          partyId: dto.partyId,
        },
        include: ASSIGNMENT_INCLUDE,
      });
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'event_type_sponsor',
      entityRef: String(created.id),
      summary: `Registered ${this.nameOf(created.party)} as a sponsor of ${created.eventType.nameTa} (${this.labelOf(created)})`,
    });

    return this.toAssignment(created, NO_OCCURRENCES, true);
  }

  async update(
    id: number,
    dto: UpdateSponsorDto,
    context: ActorContext,
  ): Promise<SponsorAssignmentDto> {
    const before = await this.prisma.eventTypeSponsor.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });

    if (!before) throw new NotFoundException(`Sponsor ${id} was not found`);
    if (dto.partyId) await this.assertPartyIsUsable(dto.partyId);

    const eventTypeId = dto.eventTypeId ?? before.eventTypeId;
    const instanceIdentifier =
      dto.instanceIdentifier === undefined ? before.instanceIdentifier : dto.instanceIdentifier;
    const partyId = dto.partyId ?? before.partyId;

    if (eventTypeId !== before.eventTypeId || instanceIdentifier !== before.instanceIdentifier) {
      await this.assertSlotExists(eventTypeId, instanceIdentifier ?? undefined);
    }

    await this.assertNotDuplicate(eventTypeId, instanceIdentifier, partyId, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.partyRole.createMany({
        data: [{ partyId, kind: PartyKind.sponsor }],
        skipDuplicates: true,
      });

      return tx.eventTypeSponsor.update({
        where: { id },
        data: {
          eventTypeId,
          instanceIdentifier,
          partyId,
          customInstanceName: dto.customInstanceName,
        },
        include: ASSIGNMENT_INCLUDE,
      });
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_type_sponsor',
      entityRef: String(id),
      summary: `Updated the ${updated.eventType.nameTa} sponsor ${this.nameOf(updated.party)} (${this.labelOf(updated)})`,
      diff: AuditService.diff(
        {
          eventTypeId: before.eventTypeId,
          instanceIdentifier: before.instanceIdentifier,
          partyId: before.partyId,
          customInstanceName: before.customInstanceName,
        },
        {
          eventTypeId: updated.eventTypeId,
          instanceIdentifier: updated.instanceIdentifier,
          partyId: updated.partyId,
          customInstanceName: updated.customInstanceName,
        },
      ),
    });

    return this.toAssignment(updated, NO_OCCURRENCES, true);
  }

  async remove(id: number, context: ActorContext): Promise<void> {
    const assignment = await this.prisma.eventTypeSponsor.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });

    if (!assignment) throw new NotFoundException(`Sponsor ${id} was not found`);

    await this.prisma.eventTypeSponsor.delete({ where: { id } });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'event_type_sponsor',
      entityRef: String(id),
      summary: `Removed ${this.nameOf(assignment.party)} as a sponsor of ${assignment.eventType.nameTa} (${this.labelOf(assignment)})`,
    });
  }

  private async assertSlotExists(eventTypeId: number, instanceIdentifier?: number): Promise<void> {
    const eventType = await this.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: { noOfInstances: true, nameTa: true },
    });

    if (!eventType) throw new NotFoundException(`Event type ${eventTypeId} was not found`);
    if (instanceIdentifier === undefined) return;

    if (instanceIdentifier > eventType.noOfInstances) {
      throw new BadRequestException(
        `${eventType.nameTa} has ${eventType.noOfInstances} instance(s); ${instanceIdentifier} is out of range`,
      );
    }
  }

  /**
   * The composite unique index cannot police type-wide rows — Postgres treats
   * their null instance as distinct from every other null — so the duplicate
   * check lives here for both cases, and reads the same either way.
   */
  private async assertNotDuplicate(
    eventTypeId: number,
    instanceIdentifier: number | null,
    partyId: number,
    exceptId?: number,
  ): Promise<void> {
    const existing = await this.prisma.eventTypeSponsor.findFirst({
      where: {
        eventTypeId,
        instanceIdentifier,
        partyId,
        id: exceptId ? { not: exceptId } : undefined,
      },
      include: ASSIGNMENT_INCLUDE,
    });

    if (existing) {
      throw new ConflictException(
        `${this.nameOf(existing.party)} is already a sponsor of ${existing.eventType.nameTa} (${this.labelOf(existing)})`,
      );
    }
  }

  private async assertPartyIsUsable(partyId: number): Promise<void> {
    const party = await this.prisma.party.findUnique({
      where: { id: partyId },
      select: { isActive: true, nameTa: true },
    });

    if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
    if (!party.isActive) throw new BadRequestException(`${party.nameTa} is retired`);
  }

  /**
   * How many dated occurrences each sponsor stands over this year: the one slot
   * for an instance row, every slot of the type for a type-wide one.
   */
  private async countOccurrences(
    assignments: { eventTypeId: number; instanceIdentifier: number | null }[],
    year: number,
  ): Promise<OccurrenceCounts> {
    if (assignments.length === 0) return NO_OCCURRENCES;

    const rows = await this.prisma.event.groupBy({
      by: ['eventTypeId', 'instanceIdentifier'],
      where: {
        eventTypeId: { in: [...new Set(assignments.map((a) => a.eventTypeId))] },
        scheduledDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      _count: { _all: true },
    });

    const bySlot = new Map<string, number>();
    const byType = new Map<number, number>();

    for (const row of rows) {
      bySlot.set(`${row.eventTypeId}:${row.instanceIdentifier}`, row._count._all);
      byType.set(row.eventTypeId, (byType.get(row.eventTypeId) ?? 0) + row._count._all);
    }

    return { bySlot, byType };
  }

  private toAssignment(
    assignment: AssignmentRow,
    occurrences: OccurrenceCounts,
    canSeeContact: boolean,
  ): SponsorAssignmentDto {
    return {
      id: assignment.id,
      eventTypeId: assignment.eventTypeId,
      instanceIdentifier: assignment.instanceIdentifier,
      customInstanceName: assignment.customInstanceName,
      partyId: assignment.partyId,
      createdAt: assignment.createdAt,
      eventType: {
        id: assignment.eventType.id,
        name: assignment.eventType.nameTa,
        nameEn: assignment.eventType.nameEn ?? '',
        frequencyType: assignment.eventType.frequencyType,
        noOfInstances: assignment.eventType.noOfInstances,
        createdAt: assignment.eventType.createdAt,
        updatedAt: assignment.eventType.updatedAt,
      },
      sponsor: this.toSponsor(assignment.party, canSeeContact),
      instanceLabel: this.labelOf(assignment),
      occurrences:
        assignment.instanceIdentifier === null
          ? (occurrences.byType.get(assignment.eventTypeId) ?? 0)
          : (occurrences.bySlot.get(`${assignment.eventTypeId}:${assignment.instanceIdentifier}`) ??
            0),
    };
  }

  private labelOf(assignment: AssignmentRow): string {
    return describeInstance(
      assignment.eventType.frequencyType,
      assignment.instanceIdentifier,
      assignment.customInstanceName,
    );
  }

  private toSponsor(row: SponsorRow, canSeeContact: boolean): SponsorPartyDto {
    return {
      id: row.id,
      name: row.nameTa,
      nameEn: row.nameEn ?? '',
      email: canSeeContact ? (row.user?.email ?? null) : null,
      phone: canSeeContact ? row.phone : null,
      address: row.user?.address ?? '',
      userId: row.userId,
    };
  }

  private nameOf(row: Pick<SponsorRow, 'nameEn' | 'nameTa'>): string {
    return row.nameEn ?? row.nameTa;
  }
}
