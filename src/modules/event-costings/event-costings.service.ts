import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { money, toRupees, toRupeesOrNull } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, CostingStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAccountRef } from '../accounts/accounts.service';
import { describeInstance } from '../sponsors/instance-label';
import { explainMissingCosting, resolveCosting } from './costing-resolution';
import {
  CopyCostingDto,
  CostingItemDto,
  CostingLineDto,
  CostingRecordDto,
  CostingSummaryDto,
  CreateCostingDto,
  QueryCostingsDto,
  UpdateCostingDto,
  WriteCostingLineDto,
} from './dto/event-costing.dto';

const COSTING_INCLUDE = {
  eventType: true,
  slot: { include: { eventType: true } },
  lines: {
    include: { account: true, party: { select: { nameTa: true } } },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.EventCostingInclude;

type CostingRow = Prisma.EventCostingGetPayload<{ include: typeof COSTING_INCLUDE }>;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/** A Postgres `date` compares against UTC midnight, so that is how one is made. */
const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const dayBefore = (value: Date): Date => new Date(value.getTime() - 86_400_000);

@Injectable()
export class EventCostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryCostingsDto): Promise<CostingRecordDto[]> {
    const costings = await this.prisma.eventCosting.findMany({
      where: {
        eventTypeId: query.eventTypeId,
        slotId: query.slotId,
        status: query.status,
        ...(query.on
          ? {
              effectiveFrom: { lte: asDate(query.on) },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: asDate(query.on) } }],
            }
          : {}),
      },
      include: COSTING_INCLUDE,
      orderBy: [{ eventTypeId: 'asc' }, { slotId: 'asc' }, { effectiveFrom: 'desc' }],
    });

    const used = await this.usageByCosting(costings.map((costing) => costing.id));

    return costings.map((costing) => this.toRecord(costing, used.get(costing.id) ?? 0));
  }

  async findOneOrFail(id: number): Promise<CostingRecordDto> {
    const costing = await this.load(id);

    return this.toRecord(costing, await this.usage(id));
  }

  /**
   * What a slot would be quoted on a date, without costing anything.
   *
   * The calendar asks this before it offers the button, so that a day with no
   * costing behind it says why rather than failing when somebody presses it.
   */
  async resolve(slotId: number, on: Date): Promise<CostingSummaryDto> {
    const slot = await this.prisma.eventSlot.findUnique({
      where: { id: slotId },
      include: { eventType: true },
    });

    if (!slot) throw new NotFoundException(`Slot ${slotId} was not found`);

    const applicable = await this.applicableTo(slot.eventTypeId, slotId, on);

    if (!applicable) {
      return {
        costingId: null,
        sponsorAmount: null,
        expenseTotal: null,
        problem: explainMissingCosting(slot.eventType.nameTa, on),
      };
    }

    return {
      costingId: applicable.id,
      sponsorAmount: toRupees(applicable.sponsorAmount),
      expenseTotal: toRupees(this.headingTotal(applicable.lines)),
      problem: null,
    };
  }

  /** The costing in force for a slot on a date, with its lines. Null if none is. */
  async applicableTo(eventTypeId: number, slotId: number, on: Date): Promise<CostingRow | null> {
    const candidates = await this.prisma.eventCosting.findMany({
      where: {
        eventTypeId,
        OR: [{ slotId }, { slotId: null }],
        status: { not: CostingStatus.draft },
      },
      include: COSTING_INCLUDE,
    });

    return resolveCosting(candidates, slotId, on);
  }

  async create(dto: CreateCostingDto, context: ActorContext): Promise<CostingRecordDto> {
    await this.assertScope(dto.eventTypeId, dto.slotId ?? null);
    await this.assertIncomeCoding(dto.incomeAccountId, dto.incomeFundId);
    await this.assertLineCoding(dto.lines);

    /*
     * Every costing is born a draft, whatever it is going to replace. Activating
     * it is a separate act because it is the one that closes the version being
     * quoted from, and that should never be a side effect of typing figures in.
     */
    const costing = await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventCosting.create({
        data: {
          eventTypeId: dto.eventTypeId,
          slotId: dto.slotId ?? null,
          effectiveFrom: asDate(dto.effectiveFrom),
          status: CostingStatus.draft,
          sponsorAmount: dto.sponsorAmount,
          incomeAccountId: dto.incomeAccountId,
          incomeFundId: dto.incomeFundId,
          notes: dto.notes ?? null,
          createdBy: context.actor.id,
        },
      });

      await this.writeLines(tx, created.id, dto.lines);

      return created;
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'event_costing',
      entityRef: String(costing.id),
      summary: `Drafted a costing quoting ${toRupees(costing.sponsorAmount)} from ${dto.effectiveFrom}`,
    });

    return this.findOneOrFail(costing.id);
  }

  async update(
    id: number,
    dto: UpdateCostingDto,
    context: ActorContext,
  ): Promise<CostingRecordDto> {
    const before = await this.load(id);

    await this.assertRevisable(before);

    if (dto.incomeAccountId || dto.incomeFundId) {
      await this.assertIncomeCoding(
        dto.incomeAccountId ?? before.incomeAccountId,
        dto.incomeFundId ?? before.incomeFundId,
      );
    }

    if (dto.lines) await this.assertLineCoding(dto.lines);

    await this.prisma.$transaction(async (tx) => {
      await tx.eventCosting.update({
        where: { id },
        data: {
          effectiveFrom: dto.effectiveFrom ? asDate(dto.effectiveFrom) : undefined,
          sponsorAmount: dto.sponsorAmount,
          incomeAccountId: dto.incomeAccountId,
          incomeFundId: dto.incomeFundId,
          notes: dto.notes,
        },
      });

      if (dto.lines) {
        // Children go with their parents through the cascade, so the whole
        // costing is rewritten rather than reconciled row by row.
        await tx.eventCostingLine.deleteMany({ where: { costingId: id } });
        await this.writeLines(tx, id, dto.lines);
      }
    });

    const after = await this.load(id);

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_costing',
      entityRef: String(id),
      summary: `Revised the costing for ${this.scopeLabel(before)}`,
      diff: AuditService.diff(
        {
          effectiveFrom: before.effectiveFrom,
          sponsorAmount: before.sponsorAmount,
          incomeAccountId: before.incomeAccountId,
          lineCount: before.lines.length,
        },
        {
          effectiveFrom: after.effectiveFrom,
          sponsorAmount: after.sponsorAmount,
          incomeAccountId: after.incomeAccountId,
          lineCount: after.lines.length,
        },
      ),
    });

    return this.findOneOrFail(id);
  }

  /**
   * Put a draft into force, closing the version it replaces.
   *
   * The old version is not deleted and its figures are not touched: it is the
   * answer to what a pooja cost in 2024, and occurrences dated against it go on
   * pointing at it. It is closed the day before the new one opens, so that no
   * date falls into both and none falls between them.
   */
  async activate(id: number, context: ActorContext): Promise<CostingRecordDto> {
    const costing = await this.load(id);

    if (costing.status !== CostingStatus.draft) {
      throw new ConflictException(`That costing is already ${costing.status}`);
    }

    if (costing.lines.length === 0) {
      throw new ConflictException('A costing with no lines cannot be put into force');
    }

    const standing = await this.prisma.eventCosting.findFirst({
      where: {
        eventTypeId: costing.eventTypeId,
        slotId: costing.slotId,
        status: CostingStatus.active,
      },
    });

    if (standing && standing.effectiveFrom >= costing.effectiveFrom) {
      throw new BadRequestException(
        `The costing in force starts on ${isoDate(standing.effectiveFrom)}; ` +
          'a version replacing it must start after that',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Closed first: the exclusion constraint is checked as each statement
      // runs, and the two versions would otherwise both claim the same day.
      if (standing) {
        await tx.eventCosting.update({
          where: { id: standing.id },
          data: {
            effectiveTo: dayBefore(costing.effectiveFrom),
            status: CostingStatus.superseded,
          },
        });
      }

      await tx.eventCosting.update({
        where: { id },
        data: { status: CostingStatus.active },
      });
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_costing',
      entityRef: String(id),
      summary:
        `Put the costing for ${this.scopeLabel(costing)} into force from ` +
        `${isoDate(costing.effectiveFrom)}, quoting ${toRupees(costing.sponsorAmount)}` +
        (standing ? ` in place of costing ${standing.id}` : ''),
    });

    return this.findOneOrFail(id);
  }

  /**
   * Day two of a festival is day one with three figures changed.
   *
   * The copy lands as a draft on the slot named, carrying every line and its
   * itemisation, so the work is correcting what differs rather than retyping
   * what does not.
   */
  async copy(id: number, dto: CopyCostingDto, context: ActorContext): Promise<CostingRecordDto> {
    const source = await this.load(id);
    const slotId = dto.slotId ?? null;

    await this.assertScope(source.eventTypeId, slotId);

    const headings = source.lines.filter((line) => line.parentLineId === null);

    const lines: WriteCostingLineDto[] = headings.map((heading) => ({
      accountId: heading.accountId,
      fundId: heading.fundId,
      activityId: heading.activityId,
      partyId: heading.partyId,
      label: heading.label,
      amount: toRupees(heading.amount),
      chargedToSponsor: heading.chargedToSponsor,
      items: source.lines
        .filter((line) => line.parentLineId === heading.id)
        .map((item) => ({
          label: item.label ?? '',
          amount: toRupees(item.amount),
          quantity: toRupeesOrNull(item.quantity),
          unitAmount: toRupeesOrNull(item.unitAmount),
        })),
    }));

    const created = await this.create(
      {
        eventTypeId: source.eventTypeId,
        slotId,
        effectiveFrom: dto.effectiveFrom ?? isoDate(source.effectiveFrom),
        sponsorAmount: toRupees(source.sponsorAmount),
        incomeAccountId: source.incomeAccountId,
        incomeFundId: source.incomeFundId,
        notes: source.notes,
        lines,
      },
      context,
    );

    await this.audit.record(context, {
      action: 'create',
      entity: 'event_costing',
      entityRef: String(created.id),
      summary: `Copied costing ${id} onto ${created.slotLabel ?? 'every instance of the type'}`,
    });

    return created;
  }

  async remove(id: number, context: ActorContext): Promise<void> {
    const costing = await this.load(id);
    const used = await this.usage(id);

    if (used > 0) {
      throw new ConflictException(
        `${used} occurrence(s) were costed from this version; it is history and cannot be removed`,
      );
    }

    if (costing.status === CostingStatus.active) {
      throw new ConflictException(
        'That costing is in force. Draft its replacement and put that into force instead',
      );
    }

    await this.prisma.eventCosting.delete({ where: { id } });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'event_costing',
      entityRef: String(id),
      summary: `Removed the unused costing for ${this.scopeLabel(costing)}`,
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────

  /**
   * Headings first, then the items under each.
   *
   * Items inherit the heading's coding rather than carrying their own, and are
   * numbered in the same sequence as the headings so that `line_no` orders the
   * whole document the way it is read.
   */
  private async writeLines(
    tx: Prisma.TransactionClient,
    costingId: number,
    lines: readonly WriteCostingLineDto[],
  ): Promise<void> {
    let lineNo = 0;

    for (const heading of lines) {
      lineNo += 1;

      const parent = await tx.eventCostingLine.create({
        data: {
          costingId,
          lineNo,
          label: heading.label ?? null,
          accountId: heading.accountId,
          fundId: heading.fundId,
          activityId: heading.activityId ?? null,
          partyId: heading.partyId ?? null,
          amount: heading.amount,
          chargedToSponsor: heading.chargedToSponsor ?? true,
        },
      });

      for (const item of heading.items ?? []) {
        lineNo += 1;

        await tx.eventCostingLine.create({
          data: {
            costingId,
            parentLineId: parent.id,
            lineNo,
            label: item.label,
            accountId: heading.accountId,
            fundId: heading.fundId,
            activityId: heading.activityId ?? null,
            partyId: heading.partyId ?? null,
            amount: item.amount,
            quantity: item.quantity ?? null,
            unitAmount: item.unitAmount ?? null,
            chargedToSponsor: heading.chargedToSponsor ?? true,
          },
        });
      }
    }
  }

  // ── rules ─────────────────────────────────────────────────────────────────

  /**
   * A costing may be revised until an occurrence has been costed from it.
   *
   * After that its figures are what somebody was quoted, so the way to change
   * them is a new version — which leaves the old one readable beside it.
   */
  private async assertRevisable(costing: CostingRow): Promise<void> {
    const used = await this.usage(costing.id);

    if (used > 0) {
      throw new ConflictException(
        `${used} occurrence(s) were costed from this version. ` +
          'Draft a replacement and put it into force from the date the new rate applies',
      );
    }

    if (costing.status === CostingStatus.superseded) {
      throw new ConflictException('A superseded costing is history and cannot be revised');
    }
  }

  private async assertScope(eventTypeId: number, slotId: number | null): Promise<void> {
    const type = await this.prisma.eventType.findUnique({ where: { id: eventTypeId } });

    if (!type) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    if (slotId === null) return;

    const slot = await this.prisma.eventSlot.findUnique({ where: { id: slotId } });

    if (!slot) throw new NotFoundException(`Slot ${slotId} was not found`);

    if (slot.eventTypeId !== eventTypeId) {
      throw new BadRequestException(`Slot ${slotId} does not belong to ${type.nameTa}`);
    }
  }

  private async assertIncomeCoding(accountId: number, fundId: number): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });

    if (!account) throw new NotFoundException(`Account ${accountId} was not found`);

    if (account.type !== AccountType.income) {
      throw new BadRequestException(
        `A sponsor's receipt must name an income head; ${account.code} is ${account.type}`,
      );
    }

    if (!account.isPostable) {
      throw new BadRequestException(`${account.code} is a grouping head; name one of its children`);
    }

    await this.assertFundIsOpen(fundId);
  }

  /**
   * Every line is checked, not merely the first.
   *
   * A costing is one document. One wrong head on line three has to stop the
   * whole thing, or the temple ends up quoting from figures half of which were
   * never coded to anything the ledger will accept.
   */
  private async assertLineCoding(lines: readonly WriteCostingLineDto[]): Promise<void> {
    for (const [index, line] of lines.entries()) {
      const where = lines.length > 1 ? ` on line ${index + 1}` : '';

      const account = await this.prisma.account.findUnique({ where: { id: line.accountId } });

      if (!account) throw new NotFoundException(`Account ${line.accountId} was not found${where}`);

      if (account.type !== AccountType.expense) {
        throw new BadRequestException(
          `A costing line must name an expense head${where}; ${account.code} is ${account.type}`,
        );
      }

      if (!account.isPostable) {
        throw new BadRequestException(
          `${account.code} is a grouping head${where}; name one of its children`,
        );
      }

      if (!account.isActive) {
        throw new BadRequestException(`${account.code} is no longer in use${where}`);
      }

      await this.assertFundIsOpen(line.fundId, where);

      if (line.activityId) {
        const activity = await this.prisma.activity.findUnique({
          where: { id: line.activityId },
        });

        if (!activity) {
          throw new NotFoundException(`Activity ${line.activityId} was not found${where}`);
        }

        if (!activity.isActive) {
          throw new BadRequestException(`${activity.nameTa} is no longer an activity${where}`);
        }
      }

      if (line.partyId) {
        const party = await this.prisma.party.findUnique({ where: { id: line.partyId } });

        if (!party) throw new NotFoundException(`Party ${line.partyId} was not found${where}`);
        if (!party.isActive) {
          throw new BadRequestException(`${party.nameTa} is no longer active${where}`);
        }
      }

      this.assertItemsAddUp(line, where);
    }
  }

  /**
   * A heading equals the items under it.
   *
   * The database enforces this too, at commit; catching it here is what turns
   * "check_violation" into a sentence naming the line and both figures.
   */
  private assertItemsAddUp(line: WriteCostingLineDto, where: string): void {
    if (!line.items || line.items.length === 0) return;

    const items = line.items.reduce((total, item) => total.plus(money(item.amount)), money(0));

    if (!items.equals(money(line.amount))) {
      throw new BadRequestException(
        `The heading${where} is ${toRupees(line.amount)}, ` +
          `but the items under it come to ${toRupees(items)}`,
      );
    }
  }

  private async assertFundIsOpen(fundId: number, where = ''): Promise<void> {
    const fund = await this.prisma.fund.findUnique({ where: { id: fundId } });

    if (!fund) throw new NotFoundException(`Fund ${fundId} was not found${where}`);
    if (!fund.isActive) throw new BadRequestException(`Fund ${fund.nameTa} is closed${where}`);
  }

  // ── reading ───────────────────────────────────────────────────────────────

  private async load(id: number): Promise<CostingRow> {
    const costing = await this.prisma.eventCosting.findUnique({
      where: { id },
      include: COSTING_INCLUDE,
    });

    if (!costing) throw new NotFoundException(`Costing ${id} was not found`);

    return costing;
  }

  private usage(id: number): Promise<number> {
    return this.prisma.event.count({ where: { costingId: id } });
  }

  private async usageByCosting(ids: readonly number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.event.groupBy({
      by: ['costingId'],
      where: { costingId: { in: [...ids] } },
      _count: { _all: true },
    });

    return new Map(
      rows.flatMap((row) => (row.costingId === null ? [] : [[row.costingId, row._count._all]])),
    );
  }

  /** Only headings count: the items under one are that heading, said in detail. */
  private headingTotal(lines: CostingRow['lines']): Prisma.Decimal {
    return lines
      .filter((line) => line.parentLineId === null)
      .reduce((total, line) => total.plus(line.amount), money(0));
  }

  private scopeLabel(costing: CostingRow): string {
    if (!costing.slot) return costing.eventType.nameTa;

    const instance = describeInstance(
      costing.slot.eventType.frequencyType,
      costing.slot.instanceIdentifier,
      costing.slot.customInstanceName,
    );

    return `${costing.eventType.nameTa} — ${instance}`;
  }

  private toRecord(costing: CostingRow, usedByEvents: number): CostingRecordDto {
    const headings = costing.lines.filter((line) => line.parentLineId === null);

    const expenseTotal = this.headingTotal(costing.lines);
    const chargedTotal = headings
      .filter((line) => line.chargedToSponsor)
      .reduce((total, line) => total.plus(line.amount), money(0));

    return {
      id: costing.id,
      eventTypeId: costing.eventTypeId,
      eventTypeName: costing.eventType.nameTa,
      slotId: costing.slotId,
      slotLabel: costing.slot
        ? describeInstance(
            costing.slot.eventType.frequencyType,
            costing.slot.instanceIdentifier,
            costing.slot.customInstanceName,
          )
        : null,
      effectiveFrom: isoDate(costing.effectiveFrom),
      effectiveTo: costing.effectiveTo ? isoDate(costing.effectiveTo) : null,
      status: costing.status,
      sponsorAmount: toRupees(costing.sponsorAmount),
      incomeAccountId: costing.incomeAccountId,
      incomeFundId: costing.incomeFundId,
      notes: costing.notes,
      lines: headings.map((heading) => this.toLine(heading, costing.lines)),
      expenseTotal: toRupees(expenseTotal),
      chargedTotal: toRupees(chargedTotal),
      templeShare: toRupees(money(costing.sponsorAmount).minus(chargedTotal)),
      usedByEvents,
      createdAt: costing.createdAt,
      updatedAt: costing.updatedAt,
    };
  }

  private toLine(heading: CostingRow['lines'][number], all: CostingRow['lines']): CostingLineDto {
    const items: CostingItemDto[] = all
      .filter((line) => line.parentLineId === heading.id)
      .map((item) => ({
        id: item.id,
        lineNo: item.lineNo,
        label: item.label ?? '',
        amount: toRupees(item.amount),
        quantity: toRupeesOrNull(item.quantity),
        unitAmount: toRupeesOrNull(item.unitAmount),
      }));

    return {
      id: heading.id,
      lineNo: heading.lineNo,
      label: heading.label,
      accountId: heading.accountId,
      account: toAccountRef(heading.account),
      fundId: heading.fundId,
      activityId: heading.activityId,
      partyId: heading.partyId,
      partyName: heading.party?.nameTa ?? null,
      amount: toRupees(heading.amount),
      chargedToSponsor: heading.chargedToSponsor,
      items,
    };
  }
}
