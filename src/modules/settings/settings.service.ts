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

  async updateAccounting(dto: AccountingSettingsDto, context: ActorContext): Promise<SettingDto> {
    if (dto.cashAccountId !== undefined) await this.assertIsCashHead(dto.cashAccountId);

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
