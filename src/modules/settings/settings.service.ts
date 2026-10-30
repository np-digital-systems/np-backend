import { BadRequestException, Injectable } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AccountingSettings,
  AccountingSettingsDto,
  SettingDto,
  TempleSettingsDto,
} from './dto/settings.dto';

const ACCOUNTING_DEFAULTS: AccountingSettings = {
  cashAccountId: null,
  sanththaAccountId: null,
  depositInterestAccountId: null,
  depositAccountId: null,
  endowmentAccountId: null,
  allowSelfApproval: false,
  depositMaturityAlertDays: 30,
};

const CACHE_TTL_MS = 60_000;

@Injectable()
export class SettingsService {
  private accountingCache: { value: AccountingSettings; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(): Promise<SettingDto[]> {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });

    return rows.map((row) => ({
      key: row.key,
      value: (row.value ?? {}) as Record<string, unknown>,
      updatedAt: row.updatedAt,
    }));
  }

  async accounting(): Promise<AccountingSettings> {
    if (this.accountingCache && this.accountingCache.expiresAt > Date.now()) {
      return this.accountingCache.value;
    }

    const row = await this.prisma.setting.findUnique({ where: { key: 'accounting' } });
    const stored = (row?.value ?? {}) as Partial<AccountingSettings>;
    const value: AccountingSettings = { ...ACCOUNTING_DEFAULTS, ...stored };

    this.accountingCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };

    return value;
  }

  /** The cash head, or a clear error explaining how to configure one. */
  async cashAccountId(): Promise<number> {
    const { cashAccountId } = await this.accounting();

    if (cashAccountId === null) {
      throw new BadRequestException(
        'No cash account is configured. Set accounting.cashAccountId to the asset head that cash movements post through.',
      );
    }

    return cashAccountId;
  }

  async updateTemple(dto: TempleSettingsDto, context: ActorContext): Promise<SettingDto> {
    return this.write('temple', { ...dto }, context);
  }

  /** The sanththa income head, or a clear error explaining how to configure one. */
  async sanththaAccountId(): Promise<number> {
    const { sanththaAccountId } = await this.accounting();

    if (sanththaAccountId === null) {
      throw new BadRequestException(
        'No sanththa head is configured. Set accounting.sanththaAccountId to the income head subscriptions are receipted to.',
      );
    }

    return sanththaAccountId;
  }

  /** The deposit interest income head, or a clear error explaining how to configure one. */
  async depositInterestAccountId(): Promise<number> {
    const { depositInterestAccountId } = await this.accounting();

    if (depositInterestAccountId === null) {
      throw new BadRequestException(
        'No deposit interest head is configured. Set accounting.depositInterestAccountId to the income head deposit interest is receipted to.',
      );
    }

    return depositInterestAccountId;
  }

  /** The asset head deposit principal sits on, or a clear error explaining how to configure one. */
  async depositAccountId(): Promise<number> {
    const { depositAccountId } = await this.accounting();

    if (depositAccountId === null) {
      throw new BadRequestException(
        'No fixed deposit head is configured. Set accounting.depositAccountId to the asset head deposits are carried on.',
      );
    }

    return depositAccountId;
  }

  /** The equity head sponsor-placed deposits are credited to, or a clear error explaining how to configure one. */
  async endowmentAccountId(): Promise<number> {
    const { endowmentAccountId } = await this.accounting();

    if (endowmentAccountId === null) {
      throw new BadRequestException(
        'No endowment head is configured. Set accounting.endowmentAccountId to the equity head sponsor-placed deposits are credited to.',
      );
    }

    return endowmentAccountId;
  }

  async updateAccounting(dto: AccountingSettingsDto, context: ActorContext): Promise<SettingDto> {
    if (dto.cashAccountId !== undefined) await this.assertIsCashHead(dto.cashAccountId);
    if (dto.sanththaAccountId !== undefined) await this.assertIsSanththaHead(dto.sanththaAccountId);
    if (dto.depositInterestAccountId !== undefined) {
      await this.assertIsDepositInterestHead(dto.depositInterestAccountId);
    }
    if (dto.depositAccountId !== undefined) await this.assertIsDepositHead(dto.depositAccountId);
    if (dto.endowmentAccountId !== undefined) {
      await this.assertIsHead(dto.endowmentAccountId, 'equity', 'The endowment head');
    }

    const written = await this.write('accounting', { ...dto }, context);
    this.accountingCache = null;

    return written;
  }

  private async assertIsCashHead(accountId: number): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    if (!account) throw new BadRequestException(`Account ${accountId} was not found`);
    if (account.type !== 'asset')
      throw new BadRequestException('The cash head must be an asset account');
    if (!account.isPostable) throw new BadRequestException('The cash head must accept entries');
  }

  // Validated when saving settings, not at the counter when money is being taken.
  private async assertIsSanththaHead(accountId: number): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    if (!account) throw new BadRequestException(`Account ${accountId} was not found`);
    if (account.type !== 'income')
      throw new BadRequestException('The sanththa head must be an income account');
    if (!account.isPostable) throw new BadRequestException('The sanththa head must accept entries');
    if (!account.isActive) throw new BadRequestException('The sanththa head must be active');
  }

  // A cash or bank head would put deposits in the cash or bank book.
  private async assertIsDepositHead(accountId: number): Promise<void> {
    await this.assertIsHead(accountId, 'asset', 'The fixed deposit head');

    const [{ cashAccountId }, bank] = await Promise.all([
      this.accounting(),
      this.prisma.bankAccount.findUnique({ where: { ledgerAccountId: accountId } }),
    ]);

    if (accountId === cashAccountId || bank) {
      throw new BadRequestException('The fixed deposit head cannot be a cash or bank head');
    }
  }

  private async assertIsHead(
    accountId: number,
    type: 'asset' | 'equity',
    label: string,
  ): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    if (!account) throw new BadRequestException(`Account ${accountId} was not found`);
    if (account.type !== type) {
      throw new BadRequestException(`${label} must be an ${type} account`);
    }
    if (!account.isPostable) throw new BadRequestException(`${label} must accept entries`);
    if (!account.isActive) throw new BadRequestException(`${label} must be active`);
  }

  private async assertIsDepositInterestHead(accountId: number): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    if (!account) throw new BadRequestException(`Account ${accountId} was not found`);
    if (account.type !== 'income')
      throw new BadRequestException('The deposit interest head must be an income account');
    if (!account.isPostable)
      throw new BadRequestException('The deposit interest head must accept entries');
    if (!account.isActive)
      throw new BadRequestException('The deposit interest head must be active');
  }

  private async write(
    key: string,
    patch: Record<string, unknown>,
    context: ActorContext,
  ): Promise<SettingDto> {
    const existing = await this.prisma.setting.findUnique({ where: { key } });
    const before = (existing?.value ?? {}) as Record<string, unknown>;
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const value = { ...before, ...defined } as Prisma.InputJsonValue;

    const row = await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedBy: context.actor.id },
      update: { value, updatedBy: context.actor.id },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'setting',
      entityRef: key,
      summary: `Updated ${key} settings`,
      diff: AuditService.diff(before, defined),
    });

    return { key: row.key, value: row.value as Record<string, unknown>, updatedAt: row.updatedAt };
  }
}
