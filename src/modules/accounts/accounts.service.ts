import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { naturalBalance } from '../../common/money/account-direction';
import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService, Sides } from '../ledger/ledger-query.service';
import { SettingsService } from '../settings/settings.service';
import {
  AccountRecordDto,
  type MoneyHead,
  AccountRefDto,
  CreateAccountDto,
  QueryAccountsDto,
  UpdateAccountDto,
} from './dto/account.dto';

type AccountRow = Prisma.AccountGetPayload<Record<string, never>>;

const article = (type: AccountType) => (/^[aeiou]/.test(type) ? `An ${type}` : `A ${type}`);

export function toAccountRef(
  account: Pick<AccountRow, 'id' | 'code' | 'nameTa' | 'nameEn' | 'type'>,
): AccountRefDto {
  return {
    id: account.id,
    code: account.code,
    name: account.nameEn ?? account.nameTa,
    nameTa: account.nameTa,
    type: account.type,
  };
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async findMany(query: QueryAccountsDto): Promise<AccountRecordDto[]> {
    const accounts = await this.prisma.account.findMany({
      where: {
        type: query.type,
        isActive: query.isActive,
        isPostable: query.postableOnly ? true : undefined,
        OR: query.search
          ? [
              { code: { contains: query.search } },
              { nameTa: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: { parent: true },
      orderBy: { code: 'asc' },
    });

    const [sides, moneyHeads] = await Promise.all([
      this.ledger.byAccount(query.financialYearId),
      this.moneyHeads(),
    ]);

    return accounts.map((account) =>
      this.toRecord(account, account.parent, sides.get(account.id), moneyHeads),
    );
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<AccountRecordDto> {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: { parent: true },
    });

    if (!account) throw new NotFoundException(`Account ${id} was not found`);

    const [sides, moneyHeads] = await Promise.all([
      this.ledger.forAccount(id, financialYearId),
      this.moneyHeads(),
    ]);

    return this.toRecord(account, account.parent, sides, moneyHeads);
  }

  /** Throws unless the account exists, is active and may be posted against. */
  async assertPostable(id: number): Promise<AccountRow> {
    const account = await this.prisma.account.findUnique({ where: { id } });

    if (!account) throw new NotFoundException(`Account ${id} was not found`);
    if (!account.isActive) throw new BadRequestException(`Account ${account.code} is inactive`);
    if (!account.isPostable) {
      throw new BadRequestException(
        `Account ${account.code} is a grouping head and takes no entries`,
      );
    }

    return account;
  }

  async create(dto: CreateAccountDto, context: ActorContext): Promise<AccountRecordDto> {
    if (dto.parentId) await this.assertParentIsCompatible(dto.parentId, dto.type);

    if (dto.openingBalance && this.isNominal(dto.type)) {
      throw new BadRequestException(
        'Income and expense heads always open at zero; they measure a year, not a position',
      );
    }

    const account = await this.prisma.account.create({
      data: {
        code: dto.code,
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        type: dto.type,
        parentId: dto.parentId,
        isPostable: dto.isPostable ?? true,
        defaultPartyId: dto.defaultPartyId ?? null,
        openingBalance: dto.openingBalance ?? 0,
      },
      include: { parent: true },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'account',
      entityRef: String(account.id),
      summary: `Created ${account.type} account ${account.code} ${account.nameTa}`,
    });

    return this.toRecord(account, account.parent, undefined, await this.moneyHeads());
  }

  async update(
    id: number,
    dto: UpdateAccountDto,
    context: ActorContext,
  ): Promise<AccountRecordDto> {
    const before = await this.prisma.account.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Account ${id} was not found`);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) throw new BadRequestException('An account cannot be its own parent');
      await this.assertParentIsCompatible(dto.parentId, before.type);
      await this.assertNotADescendant(id, dto.parentId);
    }

    if (dto.openingBalance !== undefined) await this.assertOpeningIsEditable(id, before.type);
    if (dto.isPostable === false) await this.assertNoEntries(id, 'stop accepting entries');
    if (dto.isActive === false) await this.assertNoChildrenActive(id);

    const account = await this.prisma.account.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        parentId: dto.parentId,
        isPostable: dto.isPostable,
        defaultPartyId: dto.defaultPartyId,
        isActive: dto.isActive,
        openingBalance: dto.openingBalance,
      },
      include: { parent: true },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'account',
      entityRef: String(id),
      summary: `Updated account ${account.code} ${account.nameTa}`,
      diff: AuditService.diff(
        { ...before, openingBalance: toRupees(before.openingBalance) },
        { ...account, openingBalance: toRupees(account.openingBalance) },
      ),
    });

    return this.findOneOrFail(id);
  }

  async deactivate(id: number, context: ActorContext): Promise<AccountRecordDto> {
    return this.update(id, { isActive: false }, context);
  }

  private async assertParentIsCompatible(parentId: number, type: AccountType): Promise<void> {
    const parent = await this.prisma.account.findUnique({ where: { id: parentId } });

    if (!parent) throw new NotFoundException(`Parent account ${parentId} was not found`);

    if (parent.type !== type) {
      throw new BadRequestException(
        `${article(type)} account cannot sit under the ${parent.type} head ${parent.code}`,
      );
    }
  }

  private async assertNotADescendant(id: number, candidateParentId: number): Promise<void> {
    let cursor: number | null = candidateParentId;

    for (let depth = 0; cursor !== null && depth < 32; depth += 1) {
      if (cursor === id)
        throw new BadRequestException('That would make the chart of accounts a loop');

      const parent: { parentId: number | null } | null = await this.prisma.account.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });

      cursor = parent?.parentId ?? null;
    }
  }

  private isNominal(type: AccountType): boolean {
    return type === AccountType.income || type === AccountType.expense;
  }

  private async assertOpeningIsEditable(id: number, type: AccountType): Promise<void> {
    if (this.isNominal(type)) {
      throw new BadRequestException('Income and expense heads always open at zero');
    }

    await this.assertNoEntries(id, 'have its opening balance changed');
  }

  private async assertNoEntries(id: number, what: string): Promise<void> {
    const entries = await this.prisma.ledgerEntry.count({ where: { accountId: id } });

    if (entries > 0) {
      throw new ConflictException(
        `This account has ${entries} posted entr${entries === 1 ? 'y' : 'ies'} and cannot ${what}`,
      );
    }
  }

  private async assertNoChildrenActive(id: number): Promise<void> {
    const children = await this.prisma.account.count({ where: { parentId: id, isActive: true } });

    if (children > 0) {
      throw new ConflictException(
        `Deactivate this head’s ${children} active child account(s) first`,
      );
    }
  }

  private async moneyHeads(): Promise<Map<number, MoneyHead>> {
    const [{ cashAccountId }, banks] = await Promise.all([
      this.settings.accounting(),
      this.prisma.bankAccount.findMany({ select: { ledgerAccountId: true } }),
    ]);

    const heads = new Map<number, MoneyHead>(
      banks.map((bank) => [bank.ledgerAccountId, 'bank' as const]),
    );

    if (cashAccountId !== null) heads.set(cashAccountId, 'cash');

    return heads;
  }

  private toRecord(
    account: AccountRow,
    parent: AccountRow | null,
    sides: Sides | undefined,
    moneyHeads: Map<number, MoneyHead>,
  ): AccountRecordDto {
    const totals = sides ?? LedgerQueryService.empty();
    const opening = toRupees(account.openingBalance);

    return {
      ...toAccountRef(account),
      parentId: account.parentId,
      isPostable: account.isPostable,
      defaultPartyId: account.defaultPartyId,
      isActive: account.isActive,
      openingBalance: opening,
      createdAt: account.createdAt,
      parent: parent ? toAccountRef(parent) : null,
      entryCount: totals.count,
      balance: naturalBalance(account.type, opening, totals.debit, totals.credit),
      moneyHead: moneyHeads.get(account.id) ?? null,
    };
  }
}
