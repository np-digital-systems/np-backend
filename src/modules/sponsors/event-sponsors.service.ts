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
import { EventFunding, PartyType } from '../../generated/prisma/enums';
import {
  CreateSponsorDto,
  QueryDirectoryDto,
  QuerySponsorsDto,
  SponsorAssignmentDto,
  SponsorPartyDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import { describeInstance } from './instance-label';

/** Contact detail lives on the party; the sign-in, where there is one, is only an id. */
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

type SponsorRow = Prisma.PartyGetPayload<{ select: typeof SPONSOR_SELECT }>;

const ASSIGNMENT_INCLUDE = {
  eventType: true,
  slot: true,
  party: { select: SPONSOR_SELECT },
} satisfies Prisma.EventTypeSponsorInclude;

type AssignmentRow = Prisma.EventTypeSponsorGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

/**
 * Occurrence counts, keyed by slot for a placed sponsor and by type for one
 * still waiting: until a slot is chosen, every date the type keeps this year is
 * a date they might be given.
 */
interface OccurrenceCounts {
  bySlot: Map<number, number>;
  byType: Map<number, number>;
}

const NO_OCCURRENCES: OccurrenceCounts = { bySlot: new Map(), byType: new Map() };

@Injectable()
export class EventSponsorsService {
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
   * Narrowing by instance keeps the unplaced sponsors in the result. They are
   * the people this slot would be filled from, so a screen asking "who can take
   * Week 12" wants them listed beside whoever already holds it.
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
      // Placed sponsors in slot order, then the pool still to be given one.
      orderBy: [{ slotId: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
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

    const created = await this.prisma.$transaction(async (tx) => {
      // Sponsoring something is what makes a party a sponsor, so the profile is
      // opened here rather than demanded beforehand.
      await this.ensureSponsorProfile(tx, dto.partyId);

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
    const partyId = dto.partyId ?? before.partyId;

    /*
     * `undefined` leaves the placement alone; an explicit `null` returns the
     * sponsor to the unplaced pool. Coalescing the two would make releasing a
     * slot impossible, since the release is spelled with the falsy value.
     */
    const instanceIdentifier =
      dto.instanceIdentifier === undefined
        ? (before.slot?.instanceIdentifier ?? null)
        : dto.instanceIdentifier;

    const slotId = await this.resolveSlotId(eventTypeId, instanceIdentifier);

    await this.assertNotDuplicate(eventTypeId, slotId, partyId, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.ensureSponsorProfile(tx, partyId);

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
        { slotId: before.slotId, partyId: before.partyId },
        { slotId: updated.slotId, partyId: updated.partyId },
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
   * The slot a sponsorship attaches to, if it has been given one yet.
   *
   * Naming no instance is a placement in its own right — the sponsor joins the
   * pool for the type and is given a slot later — so it is answered with null
   * rather than refused. Naming one the type never declared is still refused,
   * by lookup rather than by an arithmetic check that could drift from it.
   */
  private async resolveSlotId(
    eventTypeId: number,
    instanceIdentifier: number | null | undefined,
  ): Promise<number | null> {
    const eventType = await this.prisma.eventType.findUnique({ where: { id: eventTypeId } });

    if (!eventType) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    if (eventType.funding === EventFunding.general) {
      throw new BadRequestException(
        `${eventType.nameTa} is funded by collection and takes no registered sponsors`,
      );
    }

    if (instanceIdentifier == null) return null;

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

  /**
   * The composite unique index cannot police the unplaced pool — Postgres
   * treats each null slot as distinct from every other null — so the duplicate
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

  /** A sponsor profile is the sponsor role; opening one is idempotent. */
  private async ensureSponsorProfile(tx: Prisma.TransactionClient, partyId: number): Promise<void> {
    await tx.sponsor.upsert({
      where: { partyId },
      create: { partyId, sponsorNo: '', sponsorSince: new Date() },
      update: {},
      select: { partyId: true },
    });
  }

  private async assertPartyIsUsable(partyId: number): Promise<void> {
    const party = await this.prisma.party.findUnique({
      where: { id: partyId },
      select: { isActive: true, nameTa: true, type: true },
    });

    if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
    if (!party.isActive) throw new BadRequestException(`${party.nameTa} is retired`);
    if (party.type !== PartyType.person) {
      throw new BadRequestException(`${party.nameTa} is an organisation and cannot sponsor`);
    }
  }

  /**
   * How many dated occurrences each sponsor stands over this year: the one slot
   * for a placed row, every slot of the type for one still in the pool.
   *
   * Counted per type rather than per slot, because the unplaced rows have no
   * slot to be counted by and their type's whole year is what they stand over.
   */
  private async countOccurrences(
    assignments: { eventTypeId: number }[],
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

    const bySlot = new Map<number, number>();
    const byType = new Map<number, number>();

    for (const row of rows) {
      bySlot.set(row.slotId, (bySlot.get(row.slotId) ?? 0) + 1);
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
      // Read through the slot where there is one; null says "not placed yet".
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
          : (occurrences.bySlot.get(assignment.slotId) ?? 0),
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
      email: canSeeContact ? row.email : null,
      phone: canSeeContact ? row.phone : null,
      address: row.address ?? '',
      sponsorNo: row.sponsor?.sponsorNo ?? null,
      accountId: row.account?.id ?? null,
    };
  }

  private nameOf(row: Pick<SponsorRow, 'nameEn' | 'nameTa'>): string {
    return row.nameEn ?? row.nameTa;
  }
}
