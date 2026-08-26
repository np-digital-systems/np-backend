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
import { BankAccountTypeWire } from '../../common/enums/wire';
import { AccountType } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import {
  BankAccountRecordDto,
  BankAccountRefDto,
  CreateBankAccountDto,
  QueryBankAccountsDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';

type BankAccountRow = Prisma.BankAccountGetPayload<Record<string, never>>;

export function toBankAccountRef(
  account: Pick<BankAccountRow, 'id' | 'label' | 'type' | 'isActive'>,
): BankAccountRefDto {
  return {
    id: account.id,
    label: account.label,
    type: BankAccountTypeWire.toWire(account.type),
    isActive: account.isActive,
  };
}

/** Last four digits only; enough to recognise the account, useless to misuse. */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '');

  return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`;
}

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryBankAccountsDto): Promise<BankAccountRecordDto[]> {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { isActive: query.isActive },
      orderBy: { label: 'asc' },
    });

    const sides = await this.ledger.byAccount(query.financialYearId);

    return accounts.map((account) => this.toRecord(account, sides.get(account.ledgerAccountId)));
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<BankAccountRecordDto> {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });

    if (!account) throw new NotFoundException(`Bank account ${id} was not found`);

    const sides = await this.ledger.forAccount(account.ledgerAccountId, financialYearId);

    return this.toRecord(account, sides);
  }

  /** Throws unless the bank account exists and is open. */
  async assertUsable(id: number): Promise<BankAccountRow> {
    const account = await this.prisma.bankAccount.findUnique({ where: { id } });

    if (!account) throw new NotFoundException(`Bank account ${id} was not found`);
    if (!account.isActive) throw new BadRequestException(`${account.label} is closed`);

    return account;
  }

  async create(dto: CreateBankAccountDto, context: ActorContext): Promise<BankAccountRecordDto> {
    const ledgerAccount = await this.prisma.account.findUnique({
      where: { id: dto.ledgerAccountId },
    });

    if (!ledgerAccount) {
      throw new NotFoundException(`Ledger account ${dto.ledgerAccountId} was not found`);
    }

    if (ledgerAccount.type !== AccountType.asset) {
      throw new BadRequestException('A bank account must post through an asset head');
    }

    if (!ledgerAccount.isPostable) {
      throw new BadRequestException('That head is a grouping account and takes no entries');
    }

    const inUse = await this.prisma.bankAccount.findUnique({
      where: { ledgerAccountId: dto.ledgerAccountId },
      select: { label: true },
    });

    if (inUse) {
      throw new ConflictException(`${ledgerAccount.code} already posts for ${inUse.label}`);
    }

    const openingBalance = dto.openingBalance ?? 0;

    /*
     * The opening position is recorded once, on the ledger head, and mirrored
     * here for the certificate. Writing both in one transaction is what keeps
     * the chart of accounts and the bank book from ever disagreeing.
     */
    const account = await this.prisma.$transaction(async (tx) => {
      if (openingBalance !== 0) {
        const entries = await tx.ledgerEntry.count({ where: { accountId: dto.ledgerAccountId } });

        if (entries > 0) {
          throw new ConflictException(
            `${ledgerAccount.code} already has posted entries; its opening balance is settled`,
          );
        }

        await tx.account.update({
          where: { id: dto.ledgerAccountId },
          data: { openingBalance },
        });
      }

      return tx.bankAccount.create({
        data: {
          label: dto.label,
          bankName: dto.bankName,
          branch: dto.branch,
          accountNumber: dto.accountNumber,
          type: BankAccountTypeWire.toPrisma(dto.type),
          openingBalance,
          openedOn: new Date(dto.openedOn),
          ledgerAccountId: dto.ledgerAccountId,
        },
      });
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'bank_account',
      entityRef: String(account.id),
      summary: `Opened ${account.label} at ${account.bankName}, ${account.branch} (${maskAccountNumber(account.accountNumber)})`,
    });

    return this.findOneOrFail(account.id);
  }

  async update(
    id: number,
    dto: UpdateBankAccountDto,
    context: ActorContext,
  ): Promise<BankAccountRecordDto> {
    const before = await this.prisma.bankAccount.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Bank account ${id} was not found`);

    if (dto.openingBalance !== undefined) {
      const entries = await this.prisma.ledgerEntry.count({
        where: { OR: [{ bankAccountId: id }, { accountId: before.ledgerAccountId }] },
      });

      if (entries > 0) {
        throw new ConflictException(
          'This account has posted movements; its opening balance is settled',
        );
      }

      await this.prisma.account.update({
        where: { id: before.ledgerAccountId },
        data: { openingBalance: dto.openingBalance },
      });
    }

    const account = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        label: dto.label,
        bankName: dto.bankName,
        branch: dto.branch,
        type: BankAccountTypeWire.toPrismaOptional(dto.type),
        openingBalance: dto.openingBalance,
        openedOn: dto.openedOn ? new Date(dto.openedOn) : undefined,
        isActive: dto.isActive,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'bank_account',
      entityRef: String(id),
      summary: `Updated ${account.label}`,
      diff: AuditService.diff(
        { ...before, accountNumber: undefined, openingBalance: toRupees(before.openingBalance) },
        { ...account, accountNumber: undefined, openingBalance: toRupees(account.openingBalance) },
      ),
    });

    return this.findOneOrFail(id);
  }

  async close(id: number, context: ActorContext): Promise<BankAccountRecordDto> {
    return this.update(id, { isActive: false }, context);
  }

  private toRecord(
    account: BankAccountRow,
    sides: { debit: number; credit: number; count: number } | undefined,
    ledgerOpening?: number,
  ): BankAccountRecordDto {
    const totals = sides ?? LedgerQueryService.empty();
    const opening = ledgerOpening ?? toRupees(account.openingBalance);

    return {
      ...toBankAccountRef(account),
      bankName: account.bankName,
      branch: account.branch,
      accountNumber: maskAccountNumber(account.accountNumber),
      openingBalance: opening,
      openedOn: account.openedOn.toISOString().slice(0, 10),
      ledgerAccountId: account.ledgerAccountId,
      balance: naturalBalance(AccountType.asset, opening, totals.debit, totals.credit),
      entryCount: totals.count,
    };
  }
}
