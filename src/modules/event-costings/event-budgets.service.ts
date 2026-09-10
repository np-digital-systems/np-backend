import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { money, toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, VoucherKind, VoucherStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAccountRef } from '../accounts/accounts.service';
import { describeInstance } from '../sponsors/instance-label';
import { VouchersService } from '../vouchers/vouchers.service';
import { VoucherRecordDto } from '../vouchers/dto/voucher.dto';
import { EventCostingsService } from './event-costings.service';
import {
  BudgetLineDto,
  BudgetLineStatus,
  EventBudgetDto,
  RaisePaymentDto,
  RaiseReceiptDto,
} from './dto/event-budget.dto';

const EVENT_INCLUDE = {
  slot: { include: { eventType: true } },
  sponsor: { select: { id: true, nameTa: true, isActive: true } },
  budgetLines: {
    include: { account: true, party: { select: { nameTa: true } } },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/** Statuses whose vouchers still stand — a cancelled one settles nothing. */
const STANDING: VoucherStatus[] = [
  VoucherStatus.Draft,
  VoucherStatus.PendingApproval,
  VoucherStatus.Approved,
  VoucherStatus.Posted,
];

@Injectable()
export class EventBudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costings: EventCostingsService,
    private readonly vouchers: VouchersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Freeze the costing onto the occurrence.
   *
   * Everything after this reads the frozen copy, never the costing, so a rate
   * revised in 2029 cannot rewrite what a family was told in 2026. Only
   * headings are copied: the itemisation belongs to the quote the sponsor was
   * shown, not to the books.
   */
  async cost(eventId: number, context: ActorContext): Promise<EventBudgetDto> {
    const event = await this.load(eventId);

    if (event.isCompleted) {
      throw new ConflictException(
        'That occurrence is marked complete; reopen it before costing it again',
      );
    }

    const costing = await this.costings.applicableTo(
      event.slot.eventTypeId,
      event.slotId,
      event.scheduledDate,
    );

    if (!costing) {
      const summary = await this.costings.resolve(event.slotId, event.scheduledDate);

      throw new BadRequestException(summary.problem ?? 'No costing is in force for that day');
    }

    const headings = costing.lines.filter((line) => line.parentLineId === null);

    await this.prisma.$transaction(async (tx) => {
      await tx.eventBudgetLine.deleteMany({ where: { eventId } });

      await tx.eventBudgetLine.createMany({
        data: headings.map((heading, index) => ({
          eventId,
          lineNo: index + 1,
          // The heading as it reads today. A head renamed next year leaves what
          // the sponsor was shown exactly as it was shown.
          label: heading.label ?? heading.account.nameTa,
          accountId: heading.accountId,
          fundId: heading.fundId,
          activityId: heading.activityId,
          partyId: heading.partyId,
          amount: heading.amount,
          chargedToSponsor: heading.chargedToSponsor,
        })),
      });

      await tx.event.update({
        where: { id: eventId },
        data: { costingId: costing.id, sponsorAmount: costing.sponsorAmount },
      });
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event',
      entityRef: String(eventId),
      summary:
        `Costed ${this.describe(event)} from costing ${costing.id}: ` +
        `quoted ${toRupees(costing.sponsorAmount)} over ${headings.length} head(s)`,
    });

    return this.find(eventId);
  }

  /** The frozen budget, measured against what the ledger actually says. */
  async find(eventId: number): Promise<EventBudgetDto> {
    const event = await this.load(eventId);

    if (event.budgetLines.length === 0) {
      const summary = await this.costings.resolve(event.slotId, event.scheduledDate);

      return {
        eventId,
        costingId: null,
        sponsorAmount: null,
        sponsorReceived: null,
        lines: [],
        budgetedTotal: 0,
        actualTotal: 0,
        variance: 0,
        isFrozen: event.isCompleted,
        problem:
          summary.problem ??
          'This occurrence has not been costed yet. Costing it freezes the figures onto the day.',
      };
    }

    const [actuals, raised, received] = await Promise.all([
      this.actualsByAccount(eventId),
      this.raisedAccounts(eventId),
      this.sponsorReceived(eventId),
    ]);

    const lines = event.budgetLines.map((line) => this.toLine(line, actuals, raised));

    const budgetedTotal = lines.reduce((total, line) => total + line.budgeted, 0);
    const actualTotal = lines.reduce((total, line) => total + line.actual, 0);

    return {
      eventId,
      costingId: event.costingId,
      sponsorAmount: event.sponsorAmount === null ? null : toRupees(event.sponsorAmount),
      sponsorReceived: received,
      lines,
      budgetedTotal,
      actualTotal,
      variance: Math.round((actualTotal - budgetedTotal) * 100) / 100,
      isFrozen: event.isCompleted,
      problem: null,
    };
  }

  /**
   * The sponsor's receipt, filled in from the frozen quote.
   *
   * It stops at Draft. The cashier still names the date and how the money came,
   * and still submits it into the same approval queue as every other entry:
   * filling a form in is not the same as approving one.
   */
  async raiseReceipt(
    eventId: number,
    dto: RaiseReceiptDto,
    context: ActorContext,
  ): Promise<VoucherRecordDto> {
    const event = await this.load(eventId);

    if (event.sponsorAmount === null || event.costingId === null) {
      throw new BadRequestException('Cost this occurrence before receipting it');
    }

    if (!event.sponsor) {
      throw new BadRequestException(
        'That occurrence has no sponsor. Assign one before raising a receipt',
      );
    }

    const already = await this.prisma.voucher.findFirst({
      where: {
        kind: VoucherKind.receipt,
        status: { in: STANDING },
        lines: { some: { eventId } },
      },
    });

    if (already) {
      throw new ConflictException(
        `${already.ref} already receipts this occurrence; cancel it before raising another`,
      );
    }

    const costing = await this.prisma.eventCosting.findUniqueOrThrow({
      where: { id: event.costingId },
    });

    const voucher = await this.vouchers.create(
      {
        kind: VoucherKind.receipt,
        date: dto.date ?? isoDate(new Date()),
        description: `${this.describe(event)} — sponsorship`,
        mode: dto.mode,
        bankAccountId: dto.bankAccountId ?? undefined,
        chequeNo: dto.chequeNo ?? undefined,
        manualVoucherNo: dto.manualVoucherNo,
        partyId: event.sponsor.id,
        party: event.sponsor.nameTa,
        lines: [
          {
            accountId: costing.incomeAccountId,
            amount: dto.amount ?? toRupees(event.sponsorAmount),
            fundId: costing.incomeFundId,
            activityId: event.slot.eventType.activityId ?? undefined,
            eventId,
          },
        ],
      },
      context,
    );

    await this.audit.record(context, {
      action: 'create',
      entity: 'event',
      entityRef: String(eventId),
      summary: `Raised ${voucher.ref} against ${this.describe(event)}`,
    });

    return voucher;
  }

  /**
   * A payment voucher settling budget lines, filled in from them.
   *
   * One voucher per payee, because a voucher names one party and one total.
   * Paying the goods shop and the melam group on one document would leave the
   * books unable to say what either of them was actually given.
   */
  async raisePayment(
    eventId: number,
    dto: RaisePaymentDto,
    context: ActorContext,
  ): Promise<VoucherRecordDto> {
    const event = await this.load(eventId);
    const chosen = this.chosenLines(event, dto);

    const payee = await this.resolvePayee(chosen, dto);

    const voucher = await this.vouchers.create(
      {
        kind: VoucherKind.payment,
        date: dto.date ?? isoDate(new Date()),
        description: `${this.describe(event)} — ${chosen.map((line) => line.label).join(', ')}`,
        mode: dto.mode,
        bankAccountId: dto.bankAccountId ?? undefined,
        chequeNo: dto.chequeNo ?? undefined,
        manualVoucherNo: dto.manualVoucherNo,
        partyId: payee.partyId ?? undefined,
        party: payee.name,
        lines: chosen.map((line) => ({
          accountId: line.accountId,
          amount:
            dto.lines.find((chosenLine) => BigInt(chosenLine.budgetLineId) === line.id)?.amount ??
            toRupees(line.amount),
          fundId: line.fundId,
          activityId: line.activityId ?? undefined,
          eventId,
        })),
      },
      context,
    );

    await this.audit.record(context, {
      action: 'create',
      entity: 'event',
      entityRef: String(eventId),
      summary: `Raised ${voucher.ref} to ${payee.name} against ${this.describe(event)}`,
    });

    return voucher;
  }

  // ── rules ─────────────────────────────────────────────────────────────────

  private chosenLines(event: EventRow, dto: RaisePaymentDto): EventRow['budgetLines'] {
    const wanted = new Set(dto.lines.map((line) => BigInt(line.budgetLineId)));
    const chosen = event.budgetLines.filter((line) => wanted.has(line.id));

    if (chosen.length !== wanted.size) {
      throw new NotFoundException('Some of those budget lines do not belong to this occurrence');
    }

    return chosen;
  }

  /**
   * Every line on one voucher goes to one payee.
   *
   * The budget usually says who — the melam group, the electrician — and where
   * it does not, the cashier names them. Where it says two different people,
   * the answer is two vouchers, and saying so is more use than guessing.
   */
  private async resolvePayee(
    lines: EventRow['budgetLines'],
    dto: RaisePaymentDto,
  ): Promise<{ partyId: number | null; name: string }> {
    const named = [...new Set(lines.flatMap((line) => (line.partyId ? [line.partyId] : [])))];

    if (named.length > 1) {
      throw new BadRequestException(
        'Those lines are payable to different people. Raise one voucher for each payee',
      );
    }

    const partyId = dto.partyId ?? named[0] ?? null;

    if (partyId === null) {
      if (!dto.party) {
        throw new BadRequestException(
          'The budget does not say who is paid for this. Name the payee on the voucher',
        );
      }

      return { partyId: null, name: dto.party };
    }

    const party = await this.prisma.party.findUnique({ where: { id: partyId } });

    if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
    if (!party.isActive) throw new BadRequestException(`${party.nameTa} is no longer active`);

    return { partyId, name: dto.party ?? party.nameTa };
  }

  // ── reading ───────────────────────────────────────────────────────────────

  private async load(id: number): Promise<EventRow> {
    const event = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });

    if (!event) throw new NotFoundException(`Event ${id} was not found`);

    return event;
  }

  /** What the books say the day cost under each head, from posted entries only. */
  private async actualsByAccount(eventId: number): Promise<Map<number, number>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { eventId, account: { type: AccountType.expense } },
      _sum: { debit: true, credit: true },
    });

    return new Map(
      rows.map((row) => [
        row.accountId,
        toRupees(money(row._sum.debit ?? 0).minus(money(row._sum.credit ?? 0))),
      ]),
    );
  }

  /**
   * Which heads already carry a voucher, cancelled ones passed over.
   *
   * Derived rather than stored. A column saying "paid" goes on saying it after
   * the voucher behind it is cancelled, and a budget that lies about what has
   * been settled is worse than one that says nothing.
   */
  private async raisedAccounts(eventId: number): Promise<Map<number, BudgetLineStatus>> {
    const lines = await this.prisma.voucherLine.findMany({
      where: {
        eventId,
        voucher: { kind: VoucherKind.payment, status: { in: STANDING } },
      },
      select: { accountId: true, voucher: { select: { status: true } } },
    });

    const status = new Map<number, BudgetLineStatus>();

    for (const line of lines) {
      const posted = line.voucher.status === VoucherStatus.Posted;
      const standing = status.get(line.accountId);

      if (posted || standing !== 'Posted') {
        status.set(line.accountId, posted ? 'Posted' : 'In progress');
      }
    }

    return status;
  }

  private async sponsorReceived(eventId: number): Promise<number> {
    const receipted = await this.prisma.ledgerEntry.aggregate({
      where: { eventId, account: { type: AccountType.income } },
      _sum: { credit: true, debit: true },
    });

    return toRupees(money(receipted._sum.credit ?? 0).minus(money(receipted._sum.debit ?? 0)));
  }

  private toLine(
    line: EventRow['budgetLines'][number],
    actuals: Map<number, number>,
    raised: Map<number, BudgetLineStatus>,
  ): BudgetLineDto {
    const budgeted = toRupees(line.amount);
    const actual = actuals.get(line.accountId) ?? 0;

    return {
      id: String(line.id),
      lineNo: line.lineNo,
      label: line.label,
      accountId: line.accountId,
      account: toAccountRef(line.account),
      fundId: line.fundId,
      activityId: line.activityId,
      partyId: line.partyId,
      partyName: line.party?.nameTa ?? null,
      budgeted,
      actual,
      variance: Math.round((actual - budgeted) * 100) / 100,
      chargedToSponsor: line.chargedToSponsor,
      status: raised.get(line.accountId) ?? 'Not raised',
    };
  }

  private describe(event: EventRow): string {
    const instance = describeInstance(
      event.slot.eventType.frequencyType,
      event.slot.instanceIdentifier,
      event.slot.customInstanceName,
    );

    return `${event.slot.eventType.nameTa} — ${instance} — ${isoDate(event.scheduledDate)}`;
  }
}
