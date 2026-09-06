import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, PartyKind } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService, type Sides } from '../ledger/ledger-query.service';
import { CreatePartyDto, PartyRecordDto, QueryPartiesDto, UpdatePartyDto } from './dto/party.dto';

const PARTY_INCLUDE = {
  roles: true,
  sponsor: { select: { partyId: true } },
  account: { select: { id: true } },
} satisfies Prisma.PartyInclude;

type PartyRow = Prisma.PartyGetPayload<{ include: typeof PARTY_INCLUDE }>;

const round = (value: number) => Math.round(value * 100) / 100;

const KIND_ORDER: PartyKind[] = [PartyKind.devotee, PartyKind.vendor, PartyKind.staff];

function kindsOf(party: PartyRow): PartyKind[] {
  return KIND_ORDER.filter((kind) => party.roles.some((role) => role.kind === kind));
}

/**
 * Parties — the register of everyone the temple deals with, and the only place
 * a name is stored. People are never heads in the chart of accounts: one
 * `5200 Salaries` serves every kurukkal, and "what did we pay him" is a
 * grouping over this dimension.
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
      where: this.whereFrom(query),
      include: PARTY_INCLUDE,
      orderBy: { nameTa: 'asc' },
    });

    const totals = await this.ledger.byDimensionAndType('partyId', query.financialYearId);

    return parties.map((party) => this.toRecord(party, totals.get(party.id)));
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<PartyRecordDto> {
    const party = await this.prisma.party.findUnique({ where: { id }, include: PARTY_INCLUDE });

    if (!party) throw new NotFoundException(`Party ${id} was not found`);

    const totals = await this.ledger.byDimensionAndType('partyId', financialYearId);

    return this.toRecord(party, totals.get(id));
  }

  async create(dto: CreatePartyDto, context: ActorContext): Promise<PartyRecordDto> {
    const roles = dto.roles ?? [];

    const party = await this.prisma.party.create({
      data: {
        type: dto.type,
        nameTa: dto.nameTa,
        nameEn: dto.nameEn ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        referenceNo: dto.referenceNo ?? null,
        notes: dto.notes ?? null,
        roles: { create: roles.map((kind) => ({ kind })) },
      },
      include: PARTY_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'party',
      entityRef: String(party.id),
      summary: roles.length
        ? `Added ${party.nameTa} as ${roles.join(', ')}`
        : `Added ${party.nameTa}`,
    });

    return this.findOneOrFail(party.id);
  }

  async update(id: number, dto: UpdatePartyDto, context: ActorContext): Promise<PartyRecordDto> {
    const before = await this.prisma.party.findUnique({ where: { id }, include: PARTY_INCLUDE });

    if (!before) throw new NotFoundException(`Party ${id} was not found`);

    if (dto.isActive === false) await this.assertNothingDependsOnIt(before);

    const party = await this.prisma.party.update({
      where: { id },
      data: {
        type: dto.type,
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        referenceNo: dto.referenceNo,
        notes: dto.notes,
        isActive: dto.isActive,
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

  private whereFrom(query: QueryPartiesDto): Prisma.PartyWhereInput {
    return {
      // `some` rather than equality: a florist who also sponsors belongs in
      // both lists, and is the same record in each.
      roles: query.kind ? { some: { kind: query.kind } } : undefined,
      type: query.type,
      sponsor: query.sponsorsOnly ? { isNot: null } : undefined,
      isActive: query.isActive,
      OR: query.search
        ? [
            { nameTa: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
            { referenceNo: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
  }

  /*
   * Deactivating hides a party from the pickers; it never touches the entries
   * that name it. What it must not do is leave a screen offering somebody who
   * can no longer be chosen.
   */
  private async assertNothingDependsOnIt(party: PartyRow): Promise<void> {
    const [activities, accounts, standing, occurrences] = await Promise.all([
      this.prisma.activity.count({ where: { defaultPartyId: party.id } }),
      this.prisma.account.count({ where: { defaultPartyId: party.id } }),
      this.prisma.eventTypeSponsor.count({ where: { partyId: party.id } }),
      this.prisma.event.count({ where: { sponsorPartyId: party.id, isCompleted: false } }),
    ]);

    const blockers = [
      activities && `${activities} activity default(s)`,
      accounts && `${accounts} account default(s)`,
      standing && `${standing} standing sponsorship(s)`,
      occurrences && `${occurrences} upcoming occurrence(s)`,
    ].filter(Boolean);

    if (blockers.length > 0) {
      throw new ConflictException(
        `${party.nameTa} is still referenced by ${blockers.join(', ')}; clear those first`,
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
      type: party.type,
      name: party.nameTa,
      nameEn: party.nameEn ?? '',
      roles: kindsOf(party),
      isSponsor: party.sponsor !== null,
      accountId: party.account?.id ?? null,
      phone: party.phone,
      email: party.email,
      address: party.address,
      referenceNo: party.referenceNo,
      notes: party.notes,
      isActive: party.isActive,
      entryCount,
      contributed: round(income ? income.credit - income.debit : 0),
      paid: round(expense ? expense.debit - expense.credit : 0),
    };
  }
}
