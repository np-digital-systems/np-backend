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
  UpdatePaymentDto,
} from './dto/sanththa.dto';

const SPONSOR_INCLUDE = {
  party: { select: { nameTa: true, nameEn: true, phone: true, address: true } },
} satisfies Prisma.SponsorInclude;

type SponsorRow = Prisma.SponsorGetPayload<{ include: typeof SPONSOR_INCLUDE }>;

const PAYMENT_INCLUDE = {
  sponsor: { include: SPONSOR_INCLUDE },
  receiptVoucher: { select: { id: true, ref: true, status: true, manualVoucherNo: true } },
} satisfies Prisma.SanththaPaymentInclude;

type PaymentRow = Prisma.SanththaPaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const round = (value: number) => Math.round(value * 100) / 100;

// Discarded receipts, as opposed to unfinished ones.
const VOIDED: VoucherStatus[] = [VoucherStatus.Rejected, VoucherStatus.Cancelled];

// Same edit window as vouchers: once approved or posted, corrections need a further entry.
const CORRECTABLE: VoucherStatus[] = [
  VoucherStatus.Draft,
  VoucherStatus.PendingApproval,
  VoucherStatus.Rejected,
];

const describeSubscription = (year: number, sponsorNo: string): string =>
  `வருடாந்த சந்தா பணம் ${year} — ${sponsorNo}`;

// The rate is only a default; each payment stores its own amount, so rate changes never restate past years.
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

  // Payments already taken keep their amounts; only the default changes.
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

    // Validate everything before creating the voucher: the receipt and register row can't share a transaction.
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

  // Submitted for approval, not posted: collecting and accounting stay with two people. The party is the sponsor.
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
        description: describeSubscription(dto.year, sponsor.sponsorNo),
        mode: dto.mode,
        party: sponsor.party.nameTa,
        partyId: sponsor.partyId,
        manualVoucherNo: dto.manualVoucherNo,
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

  // Settings name only the income head; activity and fund come from the activity that defaults to it.
  // A fund is never guessed: posting to the wrong fund moves money between restricted purposes.
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

    // Exactly one or none: with two activities on the same head, picking one would be a silent guess.
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

  // Only before approval. Editing returns the receipt to Draft so it's re-approved; it's resubmitted here.
  async update(
    id: number,
    dto: UpdatePaymentDto,
    context: ActorContext,
  ): Promise<SanththaPaymentDto> {
    const before = await this.prisma.sanththaPayment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });

    if (!before) throw new NotFoundException(`Subscription ${id} was not found`);

    const receipt = before.receiptVoucher;

    if (receipt && !CORRECTABLE.includes(receipt.status)) {
      throw new ConflictException(
        `${receipt.ref} is ${VoucherStatusWire.toWire(receipt.status).toLowerCase()}; correct it with a further entry rather than by editing this one`,
      );
    }

    const amount = dto.amount ?? toRupees(before.amount);
    const paidOn = dto.paidOn ?? before.paidOn.toISOString().slice(0, 10);
    const mode = dto.mode ?? (before.mode as SubscriptionMode);
    // Older receipts may have no voucher number; ask for one here rather than fail deeper in VouchersService.
    const manualVoucherNo = dto.manualVoucherNo ?? receipt?.manualVoucherNo ?? '';

    if (receipt && manualVoucherNo.trim().length === 0) {
      throw new BadRequestException(
        `${receipt.ref} has no receipt book number; supply one to correct it`,
      );
    }

    if (receipt) {
      const coding = await this.resolveCoding();

      if (coding.fundId === null) {
        throw new BadRequestException(this.fundProblem(coding.activityName));
      }

      await this.vouchers.update(
        Number(receipt.id),
        {
          kind: VoucherKind.receipt,
          date: paidOn,
          description: describeSubscription(before.year, before.sponsor.sponsorNo),
          mode,
          party: before.sponsor.party.nameTa,
          partyId: before.sponsorId,
          manualVoucherNo,
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
        true,
      );

      await this.vouchers.submit(Number(receipt.id), context, true);
    }

    const payment = await this.prisma.sanththaPayment.update({
      where: { id },
      data: { amount, paidOn: new Date(paidOn), mode },
      include: PAYMENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'sanththa_payment',
      entityRef: String(id),
      summary: `Corrected ${before.sponsor.sponsorNo}'s ${before.year} subscription`,
      diff: AuditService.diff(
        { amount: toRupees(before.amount), paidOn: before.paidOn, mode: before.mode },
        { amount, paidOn: new Date(paidOn), mode },
      ),
    });

    return this.toPayment(payment, true);
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

  // The receipt needn't be posted yet, but must not be rejected or cancelled (no evidence of payment).
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
      receiptStatus: payment.receiptVoucher
        ? VoucherStatusWire.toWire(payment.receiptVoucher.status)
        : null,
      manualVoucherNo: payment.receiptVoucher?.manualVoucherNo ?? null,
      // No receipt means nothing to contradict, so the row stays editable.
      editable: payment.receiptVoucher ? CORRECTABLE.includes(payment.receiptVoucher.status) : true,
      mode: payment.mode as SubscriptionMode,
      collectedBy: payment.collectedBy,
      createdAt: payment.createdAt,
    };
  }
}
