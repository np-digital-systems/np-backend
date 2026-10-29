import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { InterestPayoutWire } from '../../common/enums/wire';
import { AccountType, DepositStatus, PaymentMode, VoucherKind } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { SettingsService } from '../settings/settings.service';
import { describeInstance } from '../sponsors/instance-label';
import { VoucherRecordDto } from '../vouchers/dto/voucher.dto';
import { VouchersService } from '../vouchers/vouchers.service';
import { depositMaths } from './deposit-maths';
import {
  CreateFixedDepositDto,
  DepositInterestDto,
  DepositRecordDto,
  PoojaFundingDto,
  QueryDepositsDto,
  SlotOptionDto,
  QueryPoojaFundingDto,
  RecordInterestDto,
  RenewDepositDto,
  UpdateFixedDepositDto,
} from './dto/fixed-deposit.dto';
import { netExpense, netIncome, poojaFunding } from './pooja-funding';

const DEPOSIT_INCLUDE = {
  fund: true,
  slot: { include: { eventType: true } },
} satisfies Prisma.FixedDepositInclude;

type DepositRow = Prisma.FixedDepositGetPayload<{ include: typeof DEPOSIT_INCLUDE }>;
type SlotRow = NonNullable<DepositRow['slot']>;

const describeInterest = (certificateNo: string, poojaName: string | null): string =>
  poojaName
    ? `நிலையான வைப்பு வட்டி — ${certificateNo} — ${poojaName}`
    : `நிலையான வைப்பு வட்டி — ${certificateNo}`;

const poojaNameOf = (slot: SlotRow): string =>
  slot.eventType.noOfInstances > 1
    ? `${slot.eventType.nameTa} — ${describeInstance(slot.eventType.frequencyType, slot.instanceIdentifier, slot.customInstanceName)}`
    : slot.eventType.nameTa;

@Injectable()
export class FixedDepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerQueryService,
    private readonly vouchers: VouchersService,
  ) {}

  async findMany(query: QueryDepositsDto): Promise<DepositRecordDto[]> {
    const deposits = await this.prisma.fixedDeposit.findMany({
      where: { status: query.status, fundId: query.fundId },
      include: DEPOSIT_INCLUDE,
      orderBy: { maturesOn: 'asc' },
    });

    const [{ depositMaturityAlertDays }, interest] = await Promise.all([
      this.settings.accounting(),
      this.ledger.byDimensionAndType('fixedDepositId'),
    ]);
    const records = deposits.map((deposit) =>
      this.toRecord(deposit, depositMaturityAlertDays, netIncome(interest.get(deposit.id))),
    );

    return query.maturingSoon ? records.filter((record) => record.isMaturingSoon) : records;
  }

  async findOneOrFail(id: number): Promise<DepositRecordDto> {
    const deposit = await this.prisma.fixedDeposit.findUnique({
      where: { id },
      include: DEPOSIT_INCLUDE,
    });

    if (!deposit) throw new NotFoundException(`Fixed deposit ${id} was not found`);

    const [{ depositMaturityAlertDays }, interest] = await Promise.all([
      this.settings.accounting(),
      this.ledger.byDimensionAndType('fixedDepositId'),
    ]);

    return this.toRecord(deposit, depositMaturityAlertDays, netIncome(interest.get(id)));
  }

  async create(dto: CreateFixedDepositDto, context: ActorContext): Promise<DepositRecordDto> {
    this.assertDates(dto.placedOn, dto.maturesOn);
    await this.assertFundIsActive(dto.fundId);
    if (dto.slotId) await this.assertSlotIsActive(dto.slotId);

    const deposit = await this.prisma.fixedDeposit.create({
      data: this.dataFrom(dto, dto.fundId, dto.slotId ?? null),
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
    if (dto.slotId) await this.assertSlotIsActive(dto.slotId);

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
        interestPayout: InterestPayoutWire.toPrismaOptional(dto.interestPayout),
        slotId: dto.slotId,
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

  // The old row is marked renewed (not edited) and the new one links back, keeping the renewal chain.
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
        data: { ...this.dataFrom(dto, previous.fundId, previous.slotId), renewedFromId: id },
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

  // Raised for approval like any receipt; the line names the deposit so its interest can be traced.
  async recordInterest(
    id: number,
    dto: RecordInterestDto,
    context: ActorContext,
  ): Promise<VoucherRecordDto> {
    const deposit = await this.prisma.fixedDeposit.findUnique({
      where: { id },
      include: {
        slot: {
          include: {
            eventType: { include: { activity: true } },
            sponsors: { include: { party: true }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    if (!deposit) throw new NotFoundException(`Fixed deposit ${id} was not found`);

    const accountId = await this.settings.depositInterestAccountId();

    // Inactive ones are left off rather than letting the voucher's coding checks refuse the receipt.
    const activity = deposit.slot?.eventType.activity;
    const sponsor = deposit.slot?.sponsors.find((entry) => entry.party.isActive)?.party;

    return this.vouchers.raiseForApproval(
      {
        kind: VoucherKind.receipt,
        date: dto.receivedOn,
        description: describeInterest(
          deposit.certificateNo,
          deposit.slot ? poojaNameOf(deposit.slot) : null,
        ),
        mode: dto.mode,
        bankAccountId:
          dto.mode === PaymentMode.cash
            ? undefined
            : (dto.bankAccountId ?? deposit.bankAccountId ?? undefined),
        chequeNo: dto.chequeNo,
        party: sponsor?.nameTa ?? deposit.bankName,
        partyId: sponsor?.id,
        manualVoucherNo: dto.manualVoucherNo,
        notes: dto.notes,
        lines: [
          {
            accountId,
            amount: dto.amount,
            fundId: deposit.fundId,
            activityId: activity?.isActive ? activity.id : undefined,
            fixedDepositId: id,
          },
        ],
      },
      context,
    );
  }

  // Across the renewal chain: renewing issues a new certificate, but it is the same money earning.
  async interestByYear(id: number): Promise<DepositInterestDto> {
    const chain = await this.renewalChain(id);

    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        ...this.ledger.postedIn(),
        fixedDepositId: { in: chain.map((deposit) => deposit.id) },
        account: { type: AccountType.income },
      },
      select: {
        debit: true,
        credit: true,
        voucher: {
          select: { financialYear: { select: { id: true, label: true, startsOn: true } } },
        },
      },
    });

    const years = new Map<number, { label: string; startsOn: Date; amount: number }>();

    for (const entry of entries) {
      const year = entry.voucher.financialYear;
      const running = years.get(year.id) ?? {
        label: year.label,
        startsOn: year.startsOn,
        amount: 0,
      };

      running.amount += toRupees(entry.credit) - toRupees(entry.debit);
      years.set(year.id, running);
    }

    const rows = [...years.entries()]
      .sort(([, a], [, b]) => a.startsOn.getTime() - b.startsOn.getTime())
      .map(([financialYearId, year]) => ({
        financialYearId,
        label: year.label,
        amount: Math.round(year.amount * 100) / 100,
      }));

    return {
      depositId: id,
      certificates: chain.map((deposit) => deposit.certificateNo),
      years: rows,
      total: Math.round(rows.reduce((total, row) => total + row.amount, 0) * 100) / 100,
    };
  }

  // Interest comes through the deposits; top-ups and spending are the slot's occurrences, by voucher year.
  async fundingByPooja(query: QueryPoojaFundingDto): Promise<PoojaFundingDto> {
    const year = query.financialYearId
      ? await this.prisma.financialYear.findUnique({ where: { id: query.financialYearId } })
      : await this.prisma.financialYear.findFirst({ where: { isCurrent: true } });

    if (!year) {
      throw new NotFoundException(
        query.financialYearId
          ? `Financial year ${query.financialYearId} was not found`
          : 'No financial year is marked current',
      );
    }

    const deposits = await this.prisma.fixedDeposit.findMany({
      include: {
        slot: {
          include: {
            eventType: true,
            sponsors: { include: { party: { select: { nameTa: true } } } },
          },
        },
      },
    });

    const slotIds = [...new Set(deposits.flatMap((deposit) => deposit.slotId ?? []))];

    const [interest, byEvent, events] = await Promise.all([
      this.ledger.byDimensionAndType('fixedDepositId', year.id),
      this.ledger.byDimensionAndType('eventId', year.id),
      this.prisma.event.findMany({
        where: { slotId: { in: slotIds } },
        select: { id: true, slotId: true },
      }),
    ]);

    const eventsOf = new Map<number, number[]>();

    for (const event of events) {
      eventsOf.set(event.slotId, [...(eventsOf.get(event.slotId) ?? []), event.id]);
    }

    const groups = new Map<number | null, typeof deposits>();

    for (const deposit of deposits) {
      groups.set(deposit.slotId, [...(groups.get(deposit.slotId) ?? []), deposit]);
    }

    const rows = [...groups.entries()].map(([slotId, members]) => {
      const slot = members[0].slot;
      const occurrences = slotId === null ? [] : (eventsOf.get(slotId) ?? []);
      const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

      const funding = poojaFunding(
        sum(members.map((deposit) => netIncome(interest.get(deposit.id)))),
        sum(occurrences.map((eventId) => netIncome(byEvent.get(eventId)))),
        sum(occurrences.map((eventId) => netExpense(byEvent.get(eventId)))),
      );

      return {
        slotId,
        poojaName: slot ? poojaNameOf(slot) : null,
        sponsorName: slot?.sponsors.map((sponsor) => sponsor.party.nameTa).join(', ') || null,
        deposits: members.length,
        principal: toRupees(
          members
            .filter((deposit) => deposit.status === DepositStatus.active)
            .reduce((total, deposit) => total.plus(deposit.principal), new Prisma.Decimal(0)),
        ),
        ...funding,
      };
    });

    // Poojas by name, the kovil's own deposits last.
    rows.sort((a, b) =>
      a.poojaName === null ? 1 : b.poojaName === null ? -1 : a.poojaName.localeCompare(b.poojaName),
    );

    return { financialYearId: year.id, financialYearLabel: year.label, rows };
  }

  async slotOptions(): Promise<SlotOptionDto[]> {
    const slots = await this.prisma.eventSlot.findMany({
      where: { isActive: true },
      include: { eventType: true },
      orderBy: [{ eventType: { nameTa: 'asc' } }, { instanceIdentifier: 'asc' }],
    });

    return slots.map((slot) => ({ id: slot.id, poojaName: poojaNameOf(slot) }));
  }

  private async renewalChain(id: number): Promise<{ id: number; certificateNo: string }[]> {
    const all = await this.prisma.fixedDeposit.findMany({
      select: { id: true, certificateNo: true, renewedFromId: true },
    });

    const byId = new Map(all.map((deposit) => [deposit.id, deposit]));
    const start = byId.get(id);

    if (!start) throw new NotFoundException(`Fixed deposit ${id} was not found`);

    const chain = [start];

    for (let previous = start.renewedFromId; previous !== null;) {
      const deposit = byId.get(previous);
      if (!deposit) break;
      chain.unshift(deposit);
      previous = deposit.renewedFromId;
    }

    for (let next = all.find((deposit) => deposit.renewedFromId === start.id); next;) {
      chain.push(next);
      const current = next;
      next = all.find((deposit) => deposit.renewedFromId === current.id);
    }

    return chain.map((deposit) => ({ id: deposit.id, certificateNo: deposit.certificateNo }));
  }

  private dataFrom(
    dto: CreateFixedDepositDto | RenewDepositDto,
    fundId: number,
    slotId: number | null,
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
      interestPayout: InterestPayoutWire.toPrisma(dto.interestPayout),
      fundId,
      slotId,
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

  private async assertSlotIsActive(slotId: number): Promise<void> {
    const slot = await this.prisma.eventSlot.findUnique({ where: { id: slotId } });

    if (!slot) throw new NotFoundException(`Pooja slot ${slotId} was not found`);
    if (!slot.isActive) throw new BadRequestException('That pooja slot is no longer active');
  }

  private toRecord(
    deposit: DepositRow,
    alertDays: number,
    interestReceived: number,
  ): DepositRecordDto {
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
      interestPayout: InterestPayoutWire.toWire(deposit.interestPayout),
      fundId: deposit.fundId,
      fundName: deposit.fund.nameEn ?? deposit.fund.nameTa,
      slotId: deposit.slotId,
      poojaName: deposit.slot ? poojaNameOf(deposit.slot) : null,
      bankAccountId: deposit.bankAccountId,
      status: deposit.status,
      renewedFromId: deposit.renewedFromId,
      notes: deposit.notes,
      ...maths,
      isMaturingSoon: isActive && maths.daysToMaturity >= 0 && maths.daysToMaturity <= alertDays,
      isOverdue: isActive && maths.daysToMaturity < 0,
      interestReceived,
    };
  }
}
