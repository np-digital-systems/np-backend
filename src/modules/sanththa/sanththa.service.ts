import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { VoucherKind, VoucherStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  QueryPaymentsDto,
  QueryRegisterDto,
  RecordPaymentDto,
  SanththaPaymentDto,
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

    if (dto.receiptVoucherId !== undefined) await this.assertReceipt(dto.receiptVoucherId);

    const payment = await this.prisma.sanththaPayment.create({
      data: {
        sponsorId: dto.sponsorId,
        year: dto.year,
        amount,
        paidOn: new Date(dto.paidOn),
        mode: dto.mode,
        receiptVoucherId: dto.receiptVoucherId,
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

  private async rateForOrFail(year: number): Promise<number> {
    const rate = await this.prisma.sanththaRate.findUnique({ where: { year } });

    if (!rate) {
      throw new BadRequestException(
        `No sanththa rate has been set for ${year}; set it before taking payments`,
      );
    }

    return toRupees(rate.amount);
  }

  /** A subscription may be tied to a posted receipt, and to only one. */
  private async assertReceipt(receiptVoucherId: number): Promise<void> {
    const voucher = await this.prisma.voucher.findUnique({
      where: { id: BigInt(receiptVoucherId) },
      select: { kind: true, status: true, ref: true, sanththaPayment: { select: { id: true } } },
    });

    if (!voucher) throw new NotFoundException(`Voucher ${receiptVoucherId} was not found`);
    if (voucher.kind !== VoucherKind.receipt) {
      throw new BadRequestException(`${voucher.ref} is a payment, not a receipt`);
    }
    if (voucher.status !== VoucherStatus.Posted) {
      throw new BadRequestException(`${voucher.ref} has not been posted`);
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
