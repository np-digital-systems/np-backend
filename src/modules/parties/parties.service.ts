import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, PartyKind } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService, type Sides } from '../ledger/ledger-query.service';
import { CreatePartyDto, PartyRecordDto, QueryPartiesDto, UpdatePartyDto } from './dto/party.dto';

const PARTY_INCLUDE = { roles: true } satisfies Prisma.PartyInclude;

type PartyRow = Prisma.PartyGetPayload<{ include: typeof PARTY_INCLUDE }>;

const round = (value: number) => Math.round(value * 100) / 100;

/*
 * Roles read in a fixed order rather than however the rows came back, so the
 * same party is described the same way on every screen it appears on.
 */
const KIND_ORDER: PartyKind[] = [
  PartyKind.sponsor,
  PartyKind.staff,
  PartyKind.vendor,
  PartyKind.devotee,
];

function kindsOf(party: PartyRow): PartyKind[] {
  return KIND_ORDER.filter((kind) => party.roles.some((role) => role.kind === kind));
}

/**
 * Parties — who an entry was with.
 *
 * The subsidiary ledger under the chart of accounts. People are never heads:
 * one `5200 Salaries` serves every kurukkal, and "what did we pay him" is a
 * grouping over this dimension rather than an account per person.
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryPartiesDto): Promise<PartyRecordDto[]> {
    const parties = await this.prisma.party.findMany({
      where: {
        // `some` rather than an equality: a florist who also sponsors a pooja
        // belongs in both lists, and is the same record in each.
        roles: query.kind ? { some: { kind: query.kind } } : undefined,
        isActive: query.isActive,
        OR: query.search
          ? [
              { nameTa: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: PARTY_INCLUDE,
      // A party no longer has one kind to sort by. The name is the only order
      // that stays stable as roles are added and dropped.
      orderBy: { nameTa: 'asc' },
    });

    const totals = await this.ledger.byDimensionAndType('partyId', query.financialYearId);

    return parties.map((party) => this.toRecord(party, totals.get(party.id)));
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<PartyRecordDto> {
    const party = await this.prisma.party.findUnique({
      where: { id },
      include: PARTY_INCLUDE,
    });

    if (!party) throw new NotFoundException(`Party ${id} was not found`);

    const totals = await this.ledger.byDimensionAndType('partyId', financialYearId);

    return this.toRecord(party, totals.get(id));
  }

  async create(dto: CreatePartyDto, context: ActorContext): Promise<PartyRecordDto> {
    await this.assertUserIsFree(dto.userId ?? null, null);

    const roles = dto.roles ?? [PartyKind.devotee];

    const party = await this.prisma.party.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        userId: dto.userId ?? null,
        phone: dto.phone ?? null,
        roles: { create: roles.map((kind) => ({ kind })) },
      },
      include: PARTY_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'party',
      entityRef: String(party.id),
      summary: `Added ${party.nameTa} as ${roles.join(', ')}`,
    });

    return this.findOneOrFail(party.id);
  }

  async update(id: number, dto: UpdatePartyDto, context: ActorContext): Promise<PartyRecordDto> {
    const before = await this.prisma.party.findUnique({
      where: { id },
      include: PARTY_INCLUDE,
    });

    if (!before) throw new NotFoundException(`Party ${id} was not found`);

    if (dto.userId !== undefined) await this.assertUserIsFree(dto.userId ?? null, id);
    if (dto.isActive === false) await this.assertNothingDependsOnIt(id, before.nameTa);
    if (dto.roles) await this.assertRolesStillCovered(before, dto.roles);

    const party = await this.prisma.party.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        userId: dto.userId,
        phone: dto.phone,
        isActive: dto.isActive,
        // Replaced wholesale rather than reconciled: a role set is what the
        // party is now, and a row carries nothing but the pair that names it.
        ...(dto.roles
          ? { roles: { deleteMany: {}, create: dto.roles.map((kind) => ({ kind })) } }
          : {}),
      },
      include: PARTY_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'party',
      entityRef: String(id),
      summary: `Updated ${party.nameTa}`,
      diff: AuditService.diff(
        { ...before, roles: kindsOf(before).join(', ') },
        { ...party, roles: kindsOf(party).join(', ') },
      ),
    });

    return this.findOneOrFail(id);
  }

  async deactivate(id: number, context: ActorContext): Promise<PartyRecordDto> {
    return this.update(id, { isActive: false }, context);
  }

  /**
   * Give an existing party a sign-in.
   *
   * The relationship runs this way round, not the other. A party is registered
   * the moment the temple deals with them — a sponsor, a florist, the
   * electricity board — and only some of them ever need an account. Minting a
   * party from a user instead would ask for a login before anyone wanted one,
   * which is what forced every sponsor to become a user in the first place.
   */
  async linkUser(id: number, userId: string, context: ActorContext): Promise<PartyRecordDto> {
    await this.assertUserIsFree(userId, id);

    const party = await this.prisma.party.update({
      where: { id },
      data: { userId },
      include: PARTY_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'party',
      entityRef: String(id),
      summary: `Linked ${party.nameTa} to a sign-in`,
    });

    return this.findOneOrFail(id);
  }

  private async assertUserIsFree(userId: string | null, exceptPartyId: number | null) {
    if (userId === null) return;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new NotFoundException(`User ${userId} was not found`);

    const taken = await this.prisma.party.findUnique({ where: { userId } });

    if (taken && taken.id !== exceptPartyId) {
      throw new ConflictException(`${taken.nameTa} already stands for that person`);
    }
  }

  /*
   * Deactivating hides a party from the pickers; it never touches the entries
   * that name it. What it must not do is leave an activity offering somebody
   * who can no longer be chosen.
   */
  private async assertNothingDependsOnIt(id: number, nameTa: string): Promise<void> {
    const activities = await this.prisma.activity.count({ where: { defaultPartyId: id } });

    if (activities > 0) {
      throw new ConflictException(
        `${nameTa} is still the default party on ${activities} activity(ies); clear those first`,
      );
    }
  }

  /*
   * A role may be dropped freely except where the calendar still leans on it.
   * Removing `sponsor` from someone with standing assignments would leave those
   * rows naming a party the sponsor picker can no longer offer.
   */
  private async assertRolesStillCovered(party: PartyRow, roles: PartyKind[]): Promise<void> {
    const heldSponsor = party.roles.some((role) => role.kind === PartyKind.sponsor);

    if (!heldSponsor || roles.includes(PartyKind.sponsor)) return;

    const [standing, occurrences] = await Promise.all([
      this.prisma.eventTypeSponsor.count({ where: { partyId: party.id } }),
      this.prisma.event.count({ where: { sponsorPartyId: party.id } }),
    ]);

    if (standing + occurrences > 0) {
      throw new ConflictException(
        `${party.nameTa} still sponsors ${standing} standing assignment(s) and ${occurrences} occurrence(s); clear those before dropping the sponsor role`,
      );
    }
  }

  private toRecord(party: PartyRow, totals: Map<AccountType, Sides> | undefined): PartyRecordDto {
    const income = totals?.get(AccountType.income);
    const expense = totals?.get(AccountType.expense);

    let entryCount = 0;
    for (const sides of totals?.values() ?? []) entryCount += sides.count;

    return {
      id: party.id,
      name: party.nameTa,
      nameEn: party.nameEn ?? '',
      roles: kindsOf(party),
      userId: party.userId,
      phone: party.phone,
      isActive: party.isActive,
      entryCount,
      contributed: round(income ? income.credit - income.debit : 0),
      paid: round(expense ? expense.debit - expense.credit : 0),
    };
  }
}
