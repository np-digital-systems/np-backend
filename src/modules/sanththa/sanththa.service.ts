import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { VoucherStatusWire } from '../../common/enums/wire';
import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { VoucherKind, VoucherStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { SettingsService } from '../settings/settings.service';
import {
  QueryPaymentsDto,
  QueryRegisterDto,
  RecordPaymentDto,
  SanththaPaymentDto,
  SanththaPostingDto,
  SanththaRateDto,
  SanththaRegisterRowDto,
  SanththaSponsorDto,
  SanththaSummaryDto,
  SetRateDto,
  SubscriptionMode,
} from './dto/sanththa.dto';

const SPONSOR_INCLUDE = {
  party: { select: { nameTa: true, nameEn: true, phone: true, address: true } },
} satisfies Prisma.SponsorInclude;

type SponsorRow = Prisma.SponsorGetPayload<{ include: typeof SPONSOR_INCLUDE }>;

const PAYMENT_INCLUDE = {
  sponsor: { include: SPONSOR_INCLUDE },
  receiptVoucher: { select: { ref: true } },
} satisfies Prisma.SanththaPaymentInclude;

type PaymentRow = Prisma.SanththaPaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const round = (value: number) => Math.round(value * 100) / 100;

/** Statuses that mean the receipt was thrown away rather than merely unfinished. */
const VOIDED: VoucherStatus[] = [VoucherStatus.Rejected, VoucherStatus.Cancelled];

/**
 * The annual sanththa.
 *
 * Sponsors pay it, at an amount fixed for everyone and set once a year. The
 * rate is only the default a payment starts from: what was actually taken is
 * kept on the payment, so raising the rate never restates an earlier year.
 */
@Injectable()
export class SanththaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vouchers: VouchersService,
    private readonly settings: SettingsService,
  ) {}

  async register(
    query: QueryRegisterDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SanththaRegisterRowDto>> {
    const year = query.year ?? new Date().getFullYear();

    const where: Prisma.SponsorWhereInput = {
      isActive: true,
      ...(query.outstandingOnly ? { subscribes: true, payments: { none: { year } } } : {}),
    };

    const [sponsors, total] = await this.prisma.$transaction([
      this.prisma.sponsor.findMany({
        where,
        include: { ...SPONSOR_INCLUDE, payments: { select: { year: true, amount: true } } },
        orderBy: { sponsorNo: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.sponsor.count({ where }),
    ]);

    const rows = sponsors.map((sponsor) => ({
      ...this.toSponsor(sponsor, canSeeContact),
      paidYears: sponsor.payments.map((payment) => payment.year).sort((a, b) => b - a),
      totalPaid: round(
        sponsor.payments.reduce((sum, payment) => sum + toRupees(payment.amount), 0),
      ),
      paidThisYear: sponsor.payments.some((payment) => payment.year === year),
    }));

    return new PageDto(rows, new PageMetaDto(query.page, query.limit, total));
  }

  async summary(year = new Date().getFullYear()): Promise<SanththaSummaryDto> {
    const [sponsors, subscribing, payments, rate] = await Promise.all([
      this.prisma.sponsor.count({ where: { isActive: true } }),
      this.prisma.sponsor.count({ where: { isActive: true, subscribes: true } }),
      this.prisma.sanththaPayment.aggregate({
        where: { year },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.sanththaRate.findUnique({ where: { year } }),
    ]);

    const amount = rate ? toRupees(rate.amount) : null;

    return {
      year,
      rate: amount,
      sponsors,
      subscribing,
      paid: payments._count._all,
      outstanding: Math.max(0, subscribing - payments._count._all),
      collected: toRupees(payments._sum.amount),
      expected: amount === null ? 0 : round(amount * subscribing),
    };
  }

  async rates(): Promise<SanththaRateDto[]> {
    const rows = await this.prisma.sanththaRate.findMany({ orderBy: { year: 'desc' } });

    return rows.map((row) => ({
      year: row.year,
      amount: toRupees(row.amount),
      setBy: row.setBy,
      setAt: row.setAt,
    }));
  }

  /*
   * A year already collected against may still be corrected, but the payments
   * already taken keep their own amounts. Only what the form offers changes.
   */
  async setRate(dto: SetRateDto, context: ActorContext): Promise<SanththaRateDto> {
    const rate = await this.prisma.sanththaRate.upsert({
      where: { year: dto.year },
      create: { year: dto.year, amount: dto.amount, setBy: context.actor.id },
      update: { amount: dto.amount, setBy: context.actor.id, setAt: new Date() },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'sanththa_rate',
      entityRef: String(dto.year),
      summary: `Set the ${dto.year} sanththa at ${dto.amount}`,
    });

    return { year: rate.year, amount: toRupees(rate.amount), setBy: rate.setBy, setAt: rate.setAt };
  }

  async payments(
    query: QueryPaymentsDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SanththaPaymentDto>> {
    const where: Prisma.SanththaPaymentWhereInput = {
      year: query.year,
      sponsorId: query.sponsorId,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sanththaPayment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: [{ paidOn: query.order }, { id: query.order }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.sanththaPayment.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => this.toPayment(row, canSeeContact)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async record(dto: RecordPaymentDto, context: ActorContext): Promise<SanththaPaymentDto> {
    const sponsor = await this.prisma.sponsor.findUnique({
      where: { partyId: dto.sponsorId },
      include: SPONSOR_INCLUDE,
    });

    if (!sponsor) throw new NotFoundException(`Party ${dto.sponsorId} is not a sponsor`);
    if (!sponsor.subscribes) {
      throw new BadRequestException(`${sponsor.sponsorNo} is exempt from the annual sanththa`);
    }

    const existing = await this.prisma.sanththaPayment.findUnique({
      where: { sponsorId_year: { sponsorId: dto.sponsorId, year: dto.year } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`${sponsor.sponsorNo} has already paid for ${dto.year}`);
    }

    const amount = dto.amount ?? (await this.rateForOrFail(dto.year));

    /*
     * Everything that can refuse this is checked before a voucher exists.
     *
     * The receipt and the register row are two writes that cannot be made one,
     * so the order matters: an exempt sponsor, a duplicate year, a missing rate
     * or an unusable head all raise here, while there is still nothing to undo.
     * What is left after this point is a receipt waiting for approval, and the
     * register row that says which subscription it answers.
     */
    const receiptVoucherId =
      dto.receiptVoucherId ?? (await this.raiseReceipt(sponsor, dto, amount, context));

    if (dto.receiptVoucherId !== undefined) await this.assertReceipt(dto.receiptVoucherId);

    const payment = await this.prisma.sanththaPayment.create({
      data: {
        sponsorId: dto.sponsorId,
        year: dto.year,
        amount,
        paidOn: new Date(dto.paidOn),
        mode: dto.mode,
        receiptVoucherId,
        collectedBy: context.actor.id,
      },
      include: PAYMENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'sanththa_payment',
      entityRef: String(payment.id),
      summary: `Recorded ${amount} from ${sponsor.sponsorNo} for ${dto.year}`,
    });

    return this.toPayment(payment, true);
  }

  /**
   * The receipt a subscription becomes.
   *
   * Raised here rather than by the screen that called it. A browser deciding
   * which head the temple's income lands on is a decision in the wrong place:
   * it cannot be audited, it cannot be changed without a deploy, and it was
   * carrying a hard-coded account id that had drifted out of the chart.
   *
   * It goes to the approval queue, not to the ledger. Taking the money and
   * accounting for it are two acts by two people: the register records that a
   * member paid, and an approver checks the entry before it becomes a figure
   * anybody reports. Posting it here would have let one person put money in the
   * books unreviewed, which is the control the queue exists to keep.
   *
   * The party is the sponsor themselves, so the receipt answers "who paid"
   * from the register rather than from a name typed at the counter.
   */
  private async raiseReceipt(
    sponsor: SponsorRow,
    dto: RecordPaymentDto,
    amount: number,
    context: ActorContext,
  ): Promise<number> {
    const coding = await this.resolveCoding();

    if (coding.fundId === null) {
      throw new BadRequestException(this.fundProblem(coding.activityName));
    }

    const voucher = await this.vouchers.raiseForApproval(
      {
        kind: VoucherKind.receipt,
        date: dto.paidOn,
        description: `Sanththa subscription ${dto.year} — ${sponsor.sponsorNo}`,
        mode: dto.mode,
        party: sponsor.party.nameTa,
        partyId: sponsor.partyId,
        lines: [
          {
            accountId: coding.accountId,
            amount,
            fundId: coding.fundId,
            activityId: coding.activityId ?? undefined,
          },
        ],
      },
      context,
    );

    return Number(voucher.id);
  }

  /**
   * Where a subscription is receipted, worked out rather than written down.
   *
   * Settings name one thing: the income head. Everything else follows it. The
   * activity is the one that declares this head as its default — the same
   * `activity carries the coding` link the voucher form uses — and the fund is
   * that activity's. Naming the head twice, once in settings and once beside a
   * fund id, is how the two drift apart.
   *
   * A head no activity claims is still usable, but only if it can be funded,
   * and nothing here guesses a fund: an entry in the wrong fund is money moved
   * between purposes the temple keeps deliberately separate.
   */
  private async resolveCoding(): Promise<{
    accountId: number;
    account: { code: string; nameTa: string };
    fundId: number | null;
    fundName: string | null;
    activityId: number | null;
    activityName: string | null;
  }> {
    const accountId = await this.settings.sanththaAccountId();

    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        code: true,
        nameTa: true,
        defaultForActivities: {
          where: { isActive: true },
          select: {
            id: true,
            nameTa: true,
            defaultFundId: true,
            defaultFund: { select: { nameTa: true, isActive: true } },
          },
        },
      },
    });

    if (!account) {
      throw new BadRequestException(
        `The configured sanththa head (account ${accountId}) no longer exists; choose another in the accounting settings`,
      );
    }

    // Exactly one, or none. Two activities pointing at the same head is a
    // question only the temple can answer, and picking one would answer it
    // silently in every receipt from here on.
    const activity =
      account.defaultForActivities.length === 1 ? account.defaultForActivities[0] : null;

    return {
      accountId,
      account: { code: account.code, nameTa: account.nameTa },
      fundId: activity?.defaultFund?.isActive ? activity.defaultFundId : null,
      fundName: activity?.defaultFund?.isActive ? activity.defaultFund.nameTa : null,
      activityId: activity?.id ?? null,
      activityName: activity?.nameTa ?? null,
    };
  }

  /** The same lookup the write does, for a screen that has to say where money lands. */
  async posting(): Promise<SanththaPostingDto> {
    const unconfigured = (problem: string): SanththaPostingDto => ({
      configured: false,
      accountCode: null,
      accountName: null,
      fundName: null,
      activityName: null,
      problem,
    });

    let coding: Awaited<ReturnType<typeof this.resolveCoding>>;

    try {
      coding = await this.resolveCoding();
    } catch (error) {
      return unconfigured(
        error instanceof BadRequestException ? error.message : 'The sanththa head is not usable',
      );
    }

    return {
      configured: coding.fundId !== null,
      accountCode: coding.account.code,
      accountName: coding.account.nameTa,
      fundName: coding.fundName,
      activityName: coding.activityName,
      problem: coding.fundId === null ? this.fundProblem(coding.activityName) : null,
    };
  }

  private fundProblem(activityName: string | null): string {
    return activityName === null
      ? 'No active activity names the sanththa head as its default, so there is no fund to receipt against. Give one that head, and give it a default fund.'
      : `${activityName} is the sanththa activity but has no active default fund; set one so subscriptions know which fund they belong to.`;
  }

  private async rateForOrFail(year: number): Promise<number> {
    const rate = await this.prisma.sanththaRate.findUnique({ where: { year } });

    if (!rate) {
      throw new BadRequestException(
        `No sanththa rate has been set for ${year}; set it before taking payments`,
      );
    }

    return toRupees(rate.amount);
  }

  /**
   * A subscription may be tied to one receipt, and it need not be posted yet.
   *
   * It used to have to be. That made sense while the register raised its own
   * receipt and drove it to Posted in the same breath; now the receipt waits
   * for an approver, so insisting on Posted here would reject the very rows
   * this module creates. What a subscription must never point at is a receipt
   * somebody threw away — a rejected or cancelled one is not evidence that
   * money was taken.
   */
  private async assertReceipt(receiptVoucherId: number): Promise<void> {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id: BigInt(receiptVoucherId) },
      select: { kind: true, status: true, ref: true, sanththaPayment: { select: { id: true } } },
    });

    if (!voucher) throw new NotFoundException(`Voucher ${receiptVoucherId} was not found`);
    if (voucher.kind !== VoucherKind.receipt) {
      throw new BadRequestException(`${voucher.ref} is a payment, not a receipt`);
    }
    if (VOIDED.includes(voucher.status)) {
      throw new BadRequestException(
        `${voucher.ref} was ${VoucherStatusWire.toWire(voucher.status).toLowerCase()}; a subscription cannot be evidenced by it`,
      );
    }
    if (voucher.sanththaPayment) {
      throw new ConflictException(`${voucher.ref} is already tied to another subscription`);
    }
  }

  private toSponsor(sponsor: SponsorRow, canSeeContact: boolean): SanththaSponsorDto {
    return {
      partyId: sponsor.partyId,
      sponsorNo: sponsor.sponsorNo,
      name: sponsor.party.nameEn ?? sponsor.party.nameTa,
      nameTa: sponsor.party.nameTa,
      phone: canSeeContact ? sponsor.party.phone : null,
      address: canSeeContact ? sponsor.party.address : null,
      sponsorSince: sponsor.sponsorSince.toISOString().slice(0, 10),
      subscribes: sponsor.subscribes,
    };
  }

  private toPayment(payment: PaymentRow, canSeeContact: boolean): SanththaPaymentDto {
    return {
      id: payment.id,
      sponsorId: payment.sponsorId,
      sponsor: this.toSponsor(payment.sponsor, canSeeContact),
      year: payment.year,
      amount: toRupees(payment.amount),
      paidOn: payment.paidOn.toISOString().slice(0, 10),
      receiptVoucherRef: payment.receiptVoucher?.ref ?? null,
      mode: payment.mode as SubscriptionMode,
      collectedBy: payment.collectedBy,
      createdAt: payment.createdAt,
    };
  }
}
