import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { VoucherStatusWire } from '../../common/enums/wire';
import { AccountType, PaymentMode, VoucherKind, VoucherStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountsService, toAccountRef } from '../accounts/accounts.service';
import { BankAccountsService, toBankAccountRef } from '../bank-accounts/bank-accounts.service';
import { FinancialYearsService } from '../financial-years/financial-years.service';
import { toFundRef } from '../funds/funds.service';
import { ProjectsService, toProjectRef } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import {
  CreateVoucherDto,
  QueryVouchersDto,
  RejectVoucherDto,
  UpdateVoucherDto,
  VoucherRecordDto,
  WriteVoucherLineDto,
} from './dto/voucher.dto';
import { buildPostingLines, movesThroughBank, sumLines } from './voucher-posting';

const VOUCHER_INCLUDE = {
  lines: {
    include: { account: true, fund: true, project: true },
    orderBy: { lineNo: 'asc' },
  },
  bankAccount: true,
  createdByUser: { select: { id: true, nameTa: true, fullName: true } },
  decidedByUser: { select: { id: true, nameTa: true, fullName: true } },
} satisfies Prisma.VoucherInclude;

type VoucherRow = Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>;

/*
 * Which statuses a voucher may still be edited or cancelled in.
 *
 * An entry waiting on an approver is still editable: update() sends it back to
 * Draft and clears the submission, so a correction has to be resubmitted and
 * nobody can approve a version they never read. Approved and posted entries are
 * absent by design — those are corrected by a further entry, not a rewrite.
 */
const EDITABLE: VoucherStatus[] = [
  VoucherStatus.Draft,
  VoucherStatus.PendingApproval,
  VoucherStatus.Rejected,
];
const CANCELLABLE: VoucherStatus[] = [VoucherStatus.Draft, VoucherStatus.PendingApproval];

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly years: FinancialYearsService,
    private readonly accounts: AccountsService,
    private readonly projects: ProjectsService,
    private readonly bankAccounts: BankAccountsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async findMany(
    query: QueryVouchersDto,
    context: ActorContext,
    canSeeAll: boolean,
  ): Promise<PageDto<VoucherRecordDto>> {
    const where: Prisma.VoucherWhereInput = {
      kind: query.kind,
      status: VoucherStatusWire.toPrismaOptional(query.status),
      financialYearId: query.financialYearId,
      // The coding lives on the lines, so a filter asks whether any line
      // matches rather than reading a column the header no longer has.
      lines:
        query.fundId || query.accountId || query.projectId
          ? {
              some: {
                fundId: query.fundId,
                accountId: query.accountId,
                projectId: query.projectId,
              },
            }
          : undefined,
      createdBy: canSeeAll && !query.mineOnly ? undefined : context.actor.id,
      date: this.dateRange(query.from, query.to),
      OR: query.search
        ? [
            { ref: { contains: query.search, mode: 'insensitive' } },
            { party: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.voucher.findMany({
        where,
        include: VOUCHER_INCLUDE,
        orderBy: [{ date: query.order }, { id: query.order }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.voucher.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => this.toRecord(row)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async findOneOrFail(
    id: number,
    context: ActorContext,
    canSeeAll: boolean,
  ): Promise<VoucherRecordDto> {
    const voucher = await this.load(id);

    this.assertMayAct(voucher, context, canSeeAll);

    return this.toRecord(voucher);
  }

  async create(dto: CreateVoucherDto, context: ActorContext): Promise<VoucherRecordDto> {
    const date = new Date(dto.date);
    const year = await this.years.resolveOpenYear(date);

    await this.validateCoding(dto);

    const ref = await this.allocateRef(year.id, dto.kind, year.startsOn.getUTCFullYear());

    const voucher = await this.prisma.voucher.create({
      data: {
        ref,
        kind: dto.kind,
        financialYearId: year.id,
        date,
        description: dto.description,
        amount: sumLines(dto.lines),
        mode: dto.mode,
        bankAccountId: dto.bankAccountId,
        chequeNo: dto.chequeNo,
        partyId: dto.partyId,
        party: dto.party,
        manualVoucherNo: dto.manualVoucherNo,
        eventRef: dto.eventRef,
        eventTypeId: dto.eventTypeId,
        eventId: dto.eventId,
        notes: dto.notes,
        status: VoucherStatus.Draft,
        createdBy: context.actor.id,
        lines: { create: this.lineRows(dto.lines) },
      },
      include: VOUCHER_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'voucher',
      entityRef: voucher.ref,
      summary: `Raised ${dto.kind} ${voucher.ref} for ${toRupees(voucher.amount)} from ${dto.party}`,
    });

    return this.toRecord(voucher);
  }

  async update(
    id: number,
    dto: UpdateVoucherDto,
    context: ActorContext,
    canSeeAll: boolean,
  ): Promise<VoucherRecordDto> {
    const before = await this.load(id);

    this.assertMayAct(before, context, canSeeAll);
    this.assertStatusIn(before, EDITABLE, 'edited');

    const date = new Date(dto.date);
    const year = await this.years.resolveOpenYear(date);

    await this.validateCoding(dto);

    /*
     * The lines are replaced rather than reconciled. A draft's coding is not a
     * thing with a history — it is whatever the clerk last meant — and matching
     * old rows to new would invent an identity the user never asked for.
     */
    const voucher = await this.prisma.$transaction(async (tx) => {
      await tx.voucherLine.deleteMany({ where: { voucherId: BigInt(id) } });

      return tx.voucher.update({
        where: { id },
        data: {
          kind: dto.kind,
          financialYearId: year.id,
          date,
          description: dto.description,
          amount: sumLines(dto.lines),
          mode: dto.mode,
          bankAccountId: dto.bankAccountId ?? null,
          chequeNo: dto.chequeNo ?? null,
          partyId: dto.partyId ?? null,
          party: dto.party,
          manualVoucherNo: dto.manualVoucherNo ?? null,
          eventRef: dto.eventRef ?? null,
          notes: dto.notes ?? null,
          status: VoucherStatus.Draft,
          rejectionReason: null,
          decidedBy: null,
          decidedAt: null,
          submittedAt: null,
          lines: { create: this.lineRows(dto.lines) },
        },
        include: VOUCHER_INCLUDE,
      });
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'voucher',
      entityRef: voucher.ref,
      summary: `Edited ${voucher.ref}`,
      diff: AuditService.diff(
        {
          ...before,
          amount: toRupees(before.amount),
          account: undefined,
          fund: undefined,
          project: undefined,
          bankAccount: undefined,
          createdByUser: undefined,
          decidedByUser: undefined,
        },
        {
          ...voucher,
          amount: toRupees(voucher.amount),
          account: undefined,
          fund: undefined,
          project: undefined,
          bankAccount: undefined,
          createdByUser: undefined,
          decidedByUser: undefined,
        },
      ),
    });

    return this.toRecord(voucher);
  }

  async submit(id: number, context: ActorContext, canSeeAll: boolean): Promise<VoucherRecordDto> {
    const voucher = await this.load(id);

    this.assertMayAct(voucher, context, canSeeAll);
    this.assertStatusIn(voucher, [VoucherStatus.Draft, VoucherStatus.Rejected], 'submitted');
    await this.years.resolveOpenYear(voucher.date);

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status: VoucherStatus.PendingApproval,
        submittedAt: new Date(),
        rejectionReason: null,
        decidedBy: null,
        decidedAt: null,
      },
      include: VOUCHER_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'voucher',
      entityRef: updated.ref,
      summary: `Submitted ${updated.ref} for approval`,
    });

    return this.toRecord(updated);
  }

  async approve(id: number, context: ActorContext): Promise<VoucherRecordDto> {
    const voucher = await this.load(id);

    this.assertStatusIn(voucher, [VoucherStatus.PendingApproval], 'approved');
    await this.assertNotSelfApproval(voucher, context);
    await this.years.resolveOpenYear(voucher.date);

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { status: VoucherStatus.Approved, decidedBy: context.actor.id, decidedAt: new Date() },
      include: VOUCHER_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'approve',
      entity: 'voucher',
      entityRef: updated.ref,
      summary: `Approved ${updated.ref} for ${toRupees(updated.amount)}`,
    });

    return this.toRecord(updated);
  }

  async reject(
    id: number,
    dto: RejectVoucherDto,
    context: ActorContext,
  ): Promise<VoucherRecordDto> {
    const voucher = await this.load(id);

    this.assertStatusIn(voucher, [VoucherStatus.PendingApproval], 'rejected');
    await this.assertNotSelfApproval(voucher, context);

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: {
        status: VoucherStatus.Rejected,
        decidedBy: context.actor.id,
        decidedAt: new Date(),
        rejectionReason: dto.reason,
      },
      include: VOUCHER_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'reject',
      entity: 'voucher',
      entityRef: updated.ref,
      summary: `Rejected ${updated.ref}: ${dto.reason}`,
    });

    return this.toRecord(updated);
  }

  /**
   * Write the ledger lines and freeze the row.
   *
   * Both legs and the status change happen in one transaction; the deferred
   * `ledger_balanced` trigger checks the voucher balances at commit, so a
   * half-written entry cannot reach the books.
   */
  async post(id: number, context: ActorContext): Promise<VoucherRecordDto> {
    const voucher = await this.load(id);

    this.assertStatusIn(voucher, [VoucherStatus.Approved], 'posted');
    await this.years.resolveOpenYear(voucher.date);

    const contraAccountId = movesThroughBank(voucher.mode)
      ? (await this.bankAccounts.assertUsable(voucher.bankAccountId!)).ledgerAccountId
      : await this.settings.cashAccountId();

    const lines = buildPostingLines({
      kind: voucher.kind,
      lines: voucher.lines.map((line) => ({
        accountId: line.accountId,
        amount: toRupees(line.amount),
        fundId: line.fundId,
        projectId: line.projectId,
        activityId: line.activityId,
      })),
      contraAccountId,
      bankAccountId: voucher.bankAccountId,
    });

    const posted = await this.prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.createMany({
        data: lines.map((line) => ({
          voucherId: voucher.id,
          lineNo: line.lineNo,
          date: voucher.date,
          accountId: line.accountId,
          fundId: line.fundId,
          projectId: line.projectId,
          activityId: line.activityId,
          // The party belongs to the document, so it rides every coding line
          // and none of the contra. Both sides would net it to nil.
          partyId: line.isCoding ? voucher.partyId : null,
          debit: line.debit,
          credit: line.credit,
          bankAccountId: line.bankAccountId,
        })),
      });

      return tx.voucher.update({
        where: { id },
        data: { status: VoucherStatus.Posted, postedAt: new Date() },
        include: VOUCHER_INCLUDE,
      });
    });

    await this.audit.record(context, {
      action: 'post',
      entity: 'voucher',
      entityRef: posted.ref,
      summary: `Posted ${posted.ref} for ${toRupees(posted.amount)} to the ledger`,
      diff: {
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
        })),
      },
    });

    return this.toRecord(posted);
  }

  async cancel(id: number, context: ActorContext, canSeeAll: boolean): Promise<VoucherRecordDto> {
    const voucher = await this.load(id);

    this.assertMayAct(voucher, context, canSeeAll);
    this.assertStatusIn(voucher, CANCELLABLE, 'cancelled');

    const updated = await this.prisma.voucher.update({
      where: { id },
      data: { status: VoucherStatus.Cancelled },
      include: VOUCHER_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'voucher',
      entityRef: updated.ref,
      summary: `Cancelled ${updated.ref}`,
    });

    return this.toRecord(updated);
  }

  /**
   * Allocate the next reference for a year and kind.
   *
   * A single statement, so two cashiers raising a voucher at the same moment
   * cannot be handed the same number.
   */
  private async allocateRef(
    financialYearId: number,
    kind: VoucherKind,
    year: number,
  ): Promise<string> {
    const prefix = kind === VoucherKind.receipt ? 'RV' : 'PV';

    const [row] = await this.prisma.$queryRaw<{ prefix: string; allocated: number }[]>`
      INSERT INTO voucher_sequences (financial_year_id, kind, prefix, next_no)
      VALUES (${financialYearId}, ${kind}::voucher_kind, ${prefix}, 2)
      ON CONFLICT (financial_year_id, kind)
      DO UPDATE SET next_no = voucher_sequences.next_no + 1
      RETURNING prefix, next_no - 1 AS allocated
    `;

    return `${row.prefix}-${year}-${String(row.allocated).padStart(4, '0')}`;
  }

  /** The rows a voucher's lines become, numbered in the order they were given. */
  private lineRows(lines: readonly WriteVoucherLineDto[]) {
    return lines.map((line, index) => ({
      lineNo: index + 1,
      accountId: line.accountId,
      amount: line.amount,
      fundId: line.fundId,
      projectId: line.projectId ?? null,
      activityId: line.activityId ?? null,
      note: line.note ?? null,
    }));
  }

  private async validateCoding(dto: CreateVoucherDto): Promise<void> {
    const expected = dto.kind === VoucherKind.receipt ? AccountType.income : AccountType.expense;

    /*
     * Every line is checked, not just the first. A split receipt is one
     * document, so one bad head on line three has to stop the whole thing —
     * a half-posted voucher is not something the books can describe.
     */
    for (const [index, line] of dto.lines.entries()) {
      const where = dto.lines.length > 1 ? ` on line ${index + 1}` : '';
      const account = await this.accounts.assertPostable(line.accountId);

      if (account.type !== expected) {
        throw new BadRequestException(
          `A ${dto.kind} must name an ${expected} head${where}; ${account.code} is ${account.type}`,
        );
      }

      const fund = await this.prisma.fund.findUnique({ where: { id: line.fundId } });

      if (!fund) throw new NotFoundException(`Fund ${line.fundId} was not found${where}`);
      if (!fund.isActive) throw new BadRequestException(`Fund ${fund.nameTa} is closed${where}`);

      if (line.projectId) await this.projects.assertPostable(line.projectId, line.fundId);

      if (line.activityId) {
        const activity = await this.prisma.activity.findUnique({
          where: { id: line.activityId },
        });

        if (!activity) {
          throw new NotFoundException(`Activity ${line.activityId} was not found${where}`);
        }

        if (!activity.isActive) {
          throw new BadRequestException(
            `${activity.nameTa} is no longer an active activity${where}`,
          );
        }
      }
    }

    if (dto.partyId) {
      const party = await this.prisma.party.findUnique({ where: { id: dto.partyId } });

      if (!party) throw new NotFoundException(`Party ${dto.partyId} was not found`);
      if (!party.isActive) throw new BadRequestException(`${party.nameTa} is no longer active`);
    }

    if (movesThroughBank(dto.mode)) {
      if (!dto.bankAccountId) {
        throw new BadRequestException(
          `A ${dto.mode} voucher must name the bank account it moved through`,
        );
      }

      await this.bankAccounts.assertUsable(dto.bankAccountId);

      if (dto.mode === PaymentMode.cheque && !dto.chequeNo) {
        throw new BadRequestException('A cheque voucher must carry the cheque number');
      }
    } else if (dto.bankAccountId) {
      throw new BadRequestException('A cash voucher cannot name a bank account');
    }
  }

  private async assertNotSelfApproval(voucher: VoucherRow, context: ActorContext): Promise<void> {
    if (voucher.createdBy !== context.actor.id) return;

    const { allowSelfApproval } = await this.settings.accounting();

    if (!allowSelfApproval) {
      throw new ForbiddenException(
        'You raised this voucher; approval is a second pair of eyes. An administrator can allow self-approval in the accounting settings.',
      );
    }
  }

  private assertMayAct(voucher: VoucherRow, context: ActorContext, canSeeAll: boolean): void {
    if (!canSeeAll && voucher.createdBy !== context.actor.id) {
      throw new ForbiddenException('That voucher was raised by somebody else');
    }
  }

  private assertStatusIn(voucher: VoucherRow, allowed: VoucherStatus[], verb: string): void {
    if (!allowed.includes(voucher.status)) {
      throw new ConflictException(
        `${voucher.ref} is ${VoucherStatusWire.toWire(voucher.status)} and cannot be ${verb}; ` +
          `allowed from ${allowed.map((status) => VoucherStatusWire.toWire(status)).join(' or ')}`,
      );
    }
  }

  private dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;

    return { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined };
  }

  private async load(id: number): Promise<VoucherRow> {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id },
      include: VOUCHER_INCLUDE,
    });

    if (!voucher) throw new NotFoundException(`Voucher ${id} was not found`);

    return voucher;
  }

  private toRecord(voucher: VoucherRow): VoucherRecordDto {
    const actor = (user: { id: string; nameTa: string; fullName: string | null } | null) =>
      user ? { id: user.id, name: user.fullName ?? user.nameTa } : null;

    return {
      id: Number(voucher.id),
      ref: voucher.ref,
      kind: voucher.kind,
      financialYearId: voucher.financialYearId,
      date: voucher.date.toISOString().slice(0, 10),
      description: voucher.description,
      amount: toRupees(voucher.amount),
      lines: voucher.lines.map((line) => ({
        id: Number(line.id),
        lineNo: line.lineNo,
        accountId: line.accountId,
        amount: toRupees(line.amount),
        fundId: line.fundId,
        projectId: line.projectId,
        activityId: line.activityId,
        note: line.note,
        account: toAccountRef(line.account),
        fund: toFundRef(line.fund),
        project: line.project ? toProjectRef(line.project) : null,
      })),
      partyId: voucher.partyId,
      mode: voucher.mode,
      bankAccountId: voucher.bankAccountId,
      chequeNo: voucher.chequeNo,
      party: voucher.party,
      eventRef: voucher.eventRef,
      status: VoucherStatusWire.toWire(voucher.status),
      notes: voucher.notes,
      createdBy: actor(voucher.createdByUser)!,
      createdAt: voucher.createdAt,
      submittedAt: voucher.submittedAt,
      decidedBy: actor(voucher.decidedByUser),
      decidedAt: voucher.decidedAt,
      rejectionReason: voucher.rejectionReason,
      postedAt: voucher.postedAt,
      bankAccount: voucher.bankAccount ? toBankAccountRef(voucher.bankAccount) : null,
    };
  }
}
