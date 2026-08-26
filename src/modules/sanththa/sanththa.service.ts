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
  SanththaMemberDto,
  SanththaPaymentDto,
  SanththaRegisterRowDto,
  SanththaSummaryDto,
  SubscriptionMode,
} from './dto/sanththa.dto';

const MEMBER_SELECT = {
  id: true,
  memberNo: true,
  nameTa: true,
  fullName: true,
  phone: true,
  address: true,
  joinedOn: true,
  subscribes: true,
} satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }>;

@Injectable()
export class SanththaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The register.
   *
   * A non-null `member_no` is membership — there is no separate members table,
   * because a member is a devotee or a sponsor.
   */
  async register(
    query: QueryRegisterDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SanththaRegisterRowDto>> {
    const year = query.year ?? new Date().getFullYear();

    const where: Prisma.UserWhereInput = {
      memberNo: { not: null },
      OR: query.search
        ? [
            { nameTa: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { memberNo: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
      ...(query.outstandingOnly ? { subscribes: true, subscriptionsPaid: { none: { year } } } : {}),
    };

    const [members, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: { ...MEMBER_SELECT, subscriptionsPaid: { select: { year: true, amount: true } } },
        orderBy: { memberNo: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const rows = members.map((member) => ({
      ...this.toMember(member, canSeeContact),
      paidYears: member.subscriptionsPaid.map((payment) => payment.year).sort((a, b) => b - a),
      totalPaid:
        Math.round(
          member.subscriptionsPaid.reduce((sum, payment) => sum + toRupees(payment.amount), 0) *
            100,
        ) / 100,
      paidThisYear: member.subscriptionsPaid.some((payment) => payment.year === year),
    }));

    return new PageDto(rows, new PageMetaDto(query.page, query.limit, total));
  }

  async summary(year = new Date().getFullYear()): Promise<SanththaSummaryDto> {
    const [members, subscribing, payments] = await Promise.all([
      this.prisma.user.count({ where: { memberNo: { not: null } } }),
      this.prisma.user.count({ where: { memberNo: { not: null }, subscribes: true } }),
      this.prisma.sanththaPayment.aggregate({
        where: { year },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return {
      year,
      members,
      subscribing,
      paid: payments._count._all,
      outstanding: Math.max(0, subscribing - payments._count._all),
      collected: toRupees(payments._sum.amount),
    };
  }

  async payments(
    query: QueryPaymentsDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SanththaPaymentDto>> {
    const where: Prisma.SanththaPaymentWhereInput = { year: query.year, userId: query.userId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.sanththaPayment.findMany({
        where,
        include: { user: { select: MEMBER_SELECT }, receiptVoucher: { select: { ref: true } } },
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
    const member = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { memberNo: true, nameTa: true, fullName: true },
    });

    if (!member) throw new NotFoundException(`User ${dto.userId} was not found`);

    if (!member.memberNo) {
      throw new BadRequestException(
        'That person is not on the sanththa register; enrol them before taking a subscription',
      );
    }

    const existing = await this.prisma.sanththaPayment.findUnique({
      where: { userId_year: { userId: dto.userId, year: dto.year } },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`${member.memberNo} has already paid for ${dto.year}`);
    }

    if (dto.receiptVoucherId !== undefined) await this.assertReceipt(dto.receiptVoucherId);

    const payment = await this.prisma.sanththaPayment.create({
      data: {
        userId: dto.userId,
        year: dto.year,
        amount: dto.amount,
        paidOn: new Date(dto.paidOn),
        mode: dto.mode,
        receiptVoucherId: dto.receiptVoucherId,
        collectedBy: context.actor.id,
      },
      include: { user: { select: MEMBER_SELECT }, receiptVoucher: { select: { ref: true } } },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'sanththa_payment',
      entityRef: String(payment.id),
      summary: `Recorded ${dto.amount} from ${member.memberNo} for ${dto.year}`,
    });

    return this.toPayment(payment, true);
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

  private toMember(member: MemberRow, canSeeContact: boolean): SanththaMemberDto {
    return {
      id: member.id,
      memberNo: member.memberNo!,
      name: member.fullName ?? member.nameTa,
      nameTa: member.nameTa,
      phone: canSeeContact ? member.phone : null,
      address: member.address,
      joinedOn: member.joinedOn?.toISOString().slice(0, 10) ?? null,
      subscribes: member.subscribes,
    };
  }

  private toPayment(
    payment: Prisma.SanththaPaymentGetPayload<{
      include: {
        user: { select: typeof MEMBER_SELECT };
        receiptVoucher: { select: { ref: true } };
      };
    }>,
    canSeeContact: boolean,
  ): SanththaPaymentDto {
    return {
      id: payment.id,
      userId: payment.userId,
      member: this.toMember(payment.user, canSeeContact),
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
