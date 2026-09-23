import { Injectable, NotFoundException } from '@nestjs/common';

import { money, toRupees } from '../../common/money/money';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, VoucherKind, VoucherStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAccountRef } from '../accounts/accounts.service';
import { EventCostingsService, type CostingRow } from './event-costings.service';
import {
  BudgetLineDto,
  BudgetLineStatus,
  EventBudgetDto,
  ExpectedAmountsDto,
} from './dto/event-budget.dto';

const EVENT_INCLUDE = {
  slot: { include: { eventType: true } },
  sponsor: { select: { id: true, nameTa: true, isActive: true } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

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
  ) {}

  /**
   * What this occurrence is expected to cost, for a voucher form to fill from.
   *
   * The frozen budget wins where there is one: a day already quoted is owed the
   * figure it was quoted at, whatever the rate has since become. Where the day
   * has not been costed, the costing in force on its date answers instead, so a
   * cashier receipting a Friday nobody costed still gets today's rate rather
   * than an empty box.
   */
  async expected(eventId: number): Promise<ExpectedAmountsDto> {
    const event = await this.load(eventId);

    const costing = await this.costings.applicableTo(
      event.slot.eventTypeId,
      event.slotId,
      event.scheduledDate,
    );

    if (!costing) return { costed: false, sponsorAmount: null, lines: [] };

    return {
      // Resolved, never frozen: the version in force on the day's own date is
      // the one that priced it, and the date ranges keep that true for ever.
      costed: true,
      sponsorAmount: toRupees(costing.sponsorAmount),
      lines: costing.lines
        .filter((line) => line.parentLineId === null)
        .map((line) => ({
          accountId: line.accountId,
          label: line.label ?? line.account.nameTa,
          amount: toRupees(line.amount),
        })),
    };
  }

  /**
   * What the day is expected to cost, measured against what it actually cost.
   *
   * The expectation is resolved from the version in force on the day's own
   * date, not copied onto the day beforehand. The date ranges already make that
   * answer permanent: a pooja held in 2026 resolves to the 2026 version however
   * many times the rate is revised afterwards, so there is nothing a frozen
   * copy would have protected that this does not.
   */
  async find(eventId: number): Promise<EventBudgetDto> {
    const event = await this.load(eventId);

    const costing = await this.costings.applicableTo(
      event.slot.eventTypeId,
      event.slotId,
      event.scheduledDate,
    );

    if (!costing) {
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
        problem: summary.problem,
      };
    }

    const headings = costing.lines.filter((line) => line.parentLineId === null);

    const [actuals, raised, received] = await Promise.all([
      this.actualsByAccount(eventId),
      this.raisedAccounts(eventId),
      this.sponsorReceived(eventId),
    ]);

    const lines = headings.map((heading, index) =>
      this.toLine(heading, index + 1, actuals, raised),
    );

    const budgetedTotal = lines.reduce((total, line) => total + line.budgeted, 0);
    const actualTotal = lines.reduce((total, line) => total + line.actual, 0);

    return {
      eventId,
      costingId: costing.id,
      sponsorAmount: toRupees(costing.sponsorAmount),
      sponsorReceived: received,
      lines,
      budgetedTotal,
      actualTotal,
      variance: Math.round((actualTotal - budgetedTotal) * 100) / 100,
      isFrozen: event.isCompleted,
      problem: null,
    };
  }

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
    line: CostingRow['lines'][number],
    lineNo: number,
    actuals: Map<number, number>,
    raised: Map<number, BudgetLineStatus>,
  ): BudgetLineDto {
    const budgeted = toRupees(line.amount);
    const actual = actuals.get(line.accountId) ?? 0;

    return {
      id: String(line.id),
      lineNo,
      label: line.label ?? line.account.nameTa,
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
}
