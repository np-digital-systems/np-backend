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
  slot: true,
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
              OR: [{ slot: { instanceIdentifier: query.instanceIdentifier } }, { slotId: null }],
            }),
      },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ eventTypeId: 'asc' }, { slotId: { sort: 'asc', nulls: 'first' } }],
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
    const slotId = await this.resolveSlotId(dto.eventTypeId, dto.instanceIdentifier);

    await this.assertPartyIsUsable(dto.partyId);
    await this.assertNotDuplicate(dto.eventTypeId, slotId, dto.partyId);
    await this.nameSlot(slotId, dto.customInstanceName);

    const created = await this.prisma.$transaction(async (tx) => {
      // Sponsoring something is what makes a party a sponsor. Granting the role
      // here is what lets the picker offer the temple's florist for next
      // Friday's pooja without anyone registering them a second time.
      await tx.partyRole.createMany({
        data: [{ partyId: dto.partyId, kind: PartyKind.sponsor }],
        skipDuplicates: true,
      });

      return tx.eventTypeSponsor.create({
        data: { eventTypeId: dto.eventTypeId, slotId, partyId: dto.partyId },
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
      dto.instanceIdentifier === undefined
        ? (before.slot?.instanceIdentifier ?? undefined)
        : (dto.instanceIdentifier ?? undefined);
    const partyId = dto.partyId ?? before.partyId;

    const slotId = await this.resolveSlotId(eventTypeId, instanceIdentifier);

    await this.assertNotDuplicate(eventTypeId, slotId, partyId, id);
    await this.nameSlot(slotId, dto.customInstanceName);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.partyRole.createMany({
        data: [{ partyId, kind: PartyKind.sponsor }],
        skipDuplicates: true,
      });

      return tx.eventTypeSponsor.update({
        where: { id },
        data: { eventTypeId, slotId, partyId },
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
          slotId: before.slotId,
          partyId: before.partyId,
        },
        {
          eventTypeId: updated.eventTypeId,
          slotId: updated.slotId,
          partyId: updated.partyId,
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

  /**
   * The slot a sponsorship attaches to, or null for one that covers the type.
   *
   * A slot is a row now, so an instance the type never declared is refused by
   * lookup rather than by an arithmetic check that could drift from it.
   */
  private async resolveSlotId(
    eventTypeId: number,
    instanceIdentifier?: number,
  ): Promise<number | null> {
    const eventType = await this.prisma.eventType.findUnique({ where: { id: eventTypeId } });

    if (!eventType) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    // No instance means the party takes every slot of the type.
    if (instanceIdentifier === undefined) return null;

    const slot = await this.prisma.eventSlot.findUnique({
      where: { eventTypeId_instanceIdentifier: { eventTypeId, instanceIdentifier } },
      select: { id: true },
    });

    if (!slot) {
      throw new BadRequestException(
        `${eventType.nameTa} has ${eventType.noOfInstances} instance(s); ${instanceIdentifier} is out of range`,
      );
    }

    return slot.id;
  }

  /*
   * The slot's name is fixed for every year, so registering a sponsor against
   * it may set that name — but it is written to the slot, which is the one
   * place that holds it, rather than kept beside the sponsorship.
   */
  private async nameSlot(slotId: number | null, name?: string | null): Promise<void> {
    if (slotId === null || name === undefined) return;

    await this.prisma.eventSlot.update({
      where: { id: slotId },
      data: { customInstanceName: name || null },
    });
  }

  /**
   * The composite unique index cannot police type-wide rows — Postgres treats
   * their null instance as distinct from every other null — so the duplicate
   * check lives here for both cases, and reads the same either way.
   */
  private async assertNotDuplicate(
    eventTypeId: number,
    slotId: number | null,
    partyId: number,
    exceptId?: number,
  ): Promise<void> {
    const existing = await this.prisma.eventTypeSponsor.findFirst({
      where: {
        eventTypeId,
        slotId,
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
    assignments: { eventTypeId: number; slotId: number | null }[],
    year: number,
  ): Promise<OccurrenceCounts> {
    if (assignments.length === 0) return NO_OCCURRENCES;

    const rows = await this.prisma.event.findMany({
      where: {
        slot: { eventTypeId: { in: [...new Set(assignments.map((a) => a.eventTypeId))] } },
        scheduledDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      select: { slotId: true, slot: { select: { eventTypeId: true } } },
    });

    const bySlot = new Map<string, number>();
    const byType = new Map<number, number>();

    for (const row of rows) {
      const key = String(row.slotId);

      bySlot.set(key, (bySlot.get(key) ?? 0) + 1);
      byType.set(row.slot.eventTypeId, (byType.get(row.slot.eventTypeId) ?? 0) + 1);
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
      slotId: assignment.slotId,
      // Both read through the slot, which is the one place they live now.
      instanceIdentifier: assignment.slot?.instanceIdentifier ?? null,
      customInstanceName: assignment.slot?.customInstanceName ?? null,
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
        assignment.slotId === null
          ? (occurrences.byType.get(assignment.eventTypeId) ?? 0)
          : (occurrences.bySlot.get(String(assignment.slotId)) ?? 0),
    };
  }

  private labelOf(assignment: AssignmentRow): string {
    return describeInstance(
      assignment.eventType.frequencyType,
      assignment.slot?.instanceIdentifier,
      assignment.slot?.customInstanceName,
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
