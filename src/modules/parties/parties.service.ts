import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, PartyKind } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService, type Sides } from '../ledger/ledger-query.service';
import { CreatePartyDto, PartyRecordDto, QueryPartiesDto, UpdatePartyDto } from './dto/party.dto';

type PartyRow = Prisma.PartyGetPayload<Record<string, never>>;

const round = (value: number) => Math.round(value * 100) / 100;

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
        kind: query.kind,
        isActive: query.isActive,
        OR: query.search
          ? [
              { nameTa: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      orderBy: [{ kind: 'asc' }, { nameTa: 'asc' }],
    });

    const totals = await this.ledger.byDimensionAndType('partyId', query.financialYearId);

    return parties.map((party) => this.toRecord(party, totals.get(party.id)));
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<PartyRecordDto> {
    const party = await this.prisma.party.findUnique({ where: { id } });

    if (!party) throw new NotFoundException(`Party ${id} was not found`);

    const totals = await this.ledger.byDimensionAndType('partyId', financialYearId);

    return this.toRecord(party, totals.get(id));
  }

  async create(dto: CreatePartyDto, context: ActorContext): Promise<PartyRecordDto> {
    await this.assertUserIsFree(dto.userId ?? null, null);

    const party = await this.prisma.party.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        kind: dto.kind,
        userId: dto.userId ?? null,
        phone: dto.phone ?? null,
        notes: dto.notes ?? null,
      },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'party',
      entityRef: String(party.id),
      summary: `Added ${party.kind} ${party.nameTa}`,
    });

    return this.findOneOrFail(party.id);
  }

  async update(id: number, dto: UpdatePartyDto, context: ActorContext): Promise<PartyRecordDto> {
    const before = await this.prisma.party.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Party ${id} was not found`);

    if (dto.userId !== undefined) await this.assertUserIsFree(dto.userId ?? null, id);
    if (dto.isActive === false) await this.assertNothingDependsOnIt(id, before.nameTa);

    const party = await this.prisma.party.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        kind: dto.kind,
        userId: dto.userId,
        phone: dto.phone,
        notes: dto.notes,
        isActive: dto.isActive,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'party',
      entityRef: String(id),
      summary: `Updated ${party.nameTa}`,
      diff: AuditService.diff(before, party),
    });

    return this.findOneOrFail(id);
  }

  async deactivate(id: number, context: ActorContext): Promise<PartyRecordDto> {
    return this.update(id, { isActive: false }, context);
  }

  /**
   * The party standing behind a person who signs in, created on first need.
   *
   * A sponsor exists on the calendar as a user long before anyone raises a
   * receipt for them. Rather than asking a clerk to register them twice, the
   * party is made the moment it is first wanted, and matched by user
   * thereafter so the two never drift into separate records.
   */
  async forUser(userId: string): Promise<PartyRow> {
    const existing = await this.prisma.party.findUnique({ where: { userId } });

    if (existing) return existing;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new NotFoundException(`User ${userId} was not found`);

    return this.prisma.party.create({
      data: {
        nameTa: user.nameTa,
        nameEn: user.fullName,
        kind: PartyKind.sponsor,
        userId: user.id,
        phone: user.phone,
      },
    });
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
   * that name it. What it must not do is leave an expense head pointing at
   * somebody who can no longer be chosen.
   */
  private async assertNothingDependsOnIt(id: number, nameTa: string): Promise<void> {
    const heads = await this.prisma.account.count({ where: { defaultPartyId: id } });

    if (heads > 0) {
      throw new ConflictException(
        `${nameTa} is still the default on ${heads} ledger head(s); clear those first`,
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
      kind: party.kind,
      userId: party.userId,
      phone: party.phone,
      isActive: party.isActive,
      entryCount,
      contributed: round(income ? income.credit - income.debit : 0),
      paid: round(expense ? expense.debit - expense.credit : 0),
    };
  }
}
