import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { DepositStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { depositMaths } from './deposit-maths';
import {
  CreateFixedDepositDto,
  DepositRecordDto,
  QueryDepositsDto,
  RenewDepositDto,
  UpdateFixedDepositDto,
} from './dto/fixed-deposit.dto';

type DepositRow = Prisma.FixedDepositGetPayload<{ include: { fund: true } }>;

@Injectable()
export class FixedDepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryDepositsDto): Promise<DepositRecordDto[]> {
    const deposits = await this.prisma.fixedDeposit.findMany({
      where: { status: query.status, fundId: query.fundId },
      include: { fund: true },
      orderBy: { maturesOn: 'asc' },
    });

    const { depositMaturityAlertDays } = await this.settings.accounting();
    const records = deposits.map((deposit) => this.toRecord(deposit, depositMaturityAlertDays));

    return query.maturingSoon ? records.filter((record) => record.isMaturingSoon) : records;
  }

  async findOneOrFail(id: number): Promise<DepositRecordDto> {
    const deposit = await this.prisma.fixedDeposit.findUnique({
      where: { id },
      include: { fund: true },
    });

    if (!deposit) throw new NotFoundException(`Fixed deposit ${id} was not found`);

    const { depositMaturityAlertDays } = await this.settings.accounting();

    return this.toRecord(deposit, depositMaturityAlertDays);
  }

  async create(dto: CreateFixedDepositDto, context: ActorContext): Promise<DepositRecordDto> {
    this.assertDates(dto.placedOn, dto.maturesOn);
    await this.assertFundIsActive(dto.fundId);

    const deposit = await this.prisma.fixedDeposit.create({
      data: this.dataFrom(dto, dto.fundId),
      include: { fund: true },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'fixed_deposit',
      entityRef: String(deposit.id),
      summary: `Placed ${toRupees(deposit.principal)} at ${deposit.bankName} on certificate ${deposit.certificateNo}`,
    });

    return this.findOneOrFail(deposit.id);
  }

  async update(
    id: number,
    dto: UpdateFixedDepositDto,
    context: ActorContext,
  ): Promise<DepositRecordDto> {
    const before = await this.prisma.fixedDeposit.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Fixed deposit ${id} was not found`);
    if (before.status !== DepositStatus.active) {
      throw new ConflictException(`A ${before.status} deposit cannot be edited`);
    }

    const placedOn = dto.placedOn ?? before.placedOn.toISOString().slice(0, 10);
    const maturesOn = dto.maturesOn ?? before.maturesOn.toISOString().slice(0, 10);
    this.assertDates(placedOn, maturesOn);

    const deposit = await this.prisma.fixedDeposit.update({
      where: { id },
      data: {
        bankName: dto.bankName,
        branch: dto.branch,
        principal: dto.principal,
        interestRate: dto.interestRate,
        placedOn: dto.placedOn ? new Date(dto.placedOn) : undefined,
        maturesOn: dto.maturesOn ? new Date(dto.maturesOn) : undefined,
        tenureMonths: dto.tenureMonths,
        interestPayout: dto.interestPayout,
        bankAccountId: dto.bankAccountId,
        notes: dto.notes,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'fixed_deposit',
      entityRef: String(id),
      summary: `Updated deposit ${deposit.certificateNo}`,
      diff: AuditService.diff(
        { ...before, principal: toRupees(before.principal) },
        { ...deposit, principal: toRupees(deposit.principal) },
      ),
    });

    return this.findOneOrFail(id);
  }

  async changeStatus(
    id: number,
    status: DepositStatus,
    context: ActorContext,
  ): Promise<DepositRecordDto> {
    const before = await this.prisma.fixedDeposit.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Fixed deposit ${id} was not found`);
    if (before.status === status) return this.findOneOrFail(id);
    if (before.status === DepositStatus.renewed || before.status === DepositStatus.closed) {
      throw new ConflictException(`A ${before.status} deposit is settled and cannot change again`);
    }

    await this.prisma.fixedDeposit.update({ where: { id }, data: { status } });

    await this.audit.record(context, {
      action: 'update',
      entity: 'fixed_deposit',
      entityRef: String(id),
      summary: `Marked deposit ${before.certificateNo} as ${status}`,
      diff: { status: { from: before.status, to: status } },
    });

    return this.findOneOrFail(id);
  }

  /**
   * Roll a matured deposit into a new certificate.
   *
   * The old row is marked `renewed` rather than edited, and the new one points
   * back at it, so the chain of a deposit rolled over for years stays readable.
   */
  async renew(id: number, dto: RenewDepositDto, context: ActorContext): Promise<DepositRecordDto> {
    const previous = await this.prisma.fixedDeposit.findUnique({ where: { id } });

    if (!previous) throw new NotFoundException(`Fixed deposit ${id} was not found`);
    if (previous.status === DepositStatus.renewed || previous.status === DepositStatus.closed) {
      throw new ConflictException(
        `Deposit ${previous.certificateNo} has already been ${previous.status}`,
      );
    }

    this.assertDates(dto.placedOn, dto.maturesOn);

    const renewal = await this.prisma.$transaction(async (tx) => {
      await tx.fixedDeposit.update({ where: { id }, data: { status: DepositStatus.renewed } });

      return tx.fixedDeposit.create({
        data: { ...this.dataFrom(dto, previous.fundId), renewedFromId: id },
        include: { fund: true },
      });
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'fixed_deposit',
      entityRef: String(renewal.id),
      summary: `Renewed ${previous.certificateNo} into ${renewal.certificateNo} for ${toRupees(renewal.principal)}`,
    });

    return this.findOneOrFail(renewal.id);
  }

  private dataFrom(
    dto: CreateFixedDepositDto | RenewDepositDto,
    fundId: number,
  ): Prisma.FixedDepositUncheckedCreateInput {
    return {
      certificateNo: dto.certificateNo,
      bankName: dto.bankName,
      branch: dto.branch,
      principal: dto.principal,
      interestRate: dto.interestRate,
      placedOn: new Date(dto.placedOn),
      maturesOn: new Date(dto.maturesOn),
      tenureMonths: dto.tenureMonths,
      interestPayout: dto.interestPayout,
      fundId,
      bankAccountId: dto.bankAccountId,
      notes: dto.notes,
    };
  }

  private assertDates(placedOn: string, maturesOn: string): void {
    if (new Date(maturesOn) <= new Date(placedOn)) {
      throw new BadRequestException('A deposit must mature after it is placed');
    }
  }

  private async assertFundIsActive(fundId: number): Promise<void> {
    const fund = await this.prisma.fund.findUnique({ where: { id: fundId } });

    if (!fund) throw new NotFoundException(`Fund ${fundId} was not found`);
    if (!fund.isActive) throw new BadRequestException(`Fund ${fund.nameTa} is closed`);
  }

  private toRecord(deposit: DepositRow, alertDays: number): DepositRecordDto {
    const principal = toRupees(deposit.principal);
    const rate = toRupees(deposit.interestRate);
    const maths = depositMaths(principal, rate, deposit.placedOn, deposit.maturesOn);
    const isActive = deposit.status === DepositStatus.active;

    return {
      id: deposit.id,
      certificateNo: deposit.certificateNo,
      bankName: deposit.bankName,
      branch: deposit.branch,
      principal,
      interestRate: rate,
      placedOn: deposit.placedOn.toISOString().slice(0, 10),
      maturesOn: deposit.maturesOn.toISOString().slice(0, 10),
      tenureMonths: deposit.tenureMonths,
      interestPayout: deposit.interestPayout,
      fundId: deposit.fundId,
      fundName: deposit.fund.nameEn ?? deposit.fund.nameTa,
      status: deposit.status,
      renewedFromId: deposit.renewedFromId,
      notes: deposit.notes,
      ...maths,
      isMaturingSoon: isActive && maths.daysToMaturity >= 0 && maths.daysToMaturity <= alertDays,
      isOverdue: isActive && maths.daysToMaturity < 0,
    };
  }
}
