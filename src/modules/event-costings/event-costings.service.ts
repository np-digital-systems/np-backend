import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { money, toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType, CostingStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { toAccountRef } from '../accounts/accounts.service';
import { describeInstance } from '../sponsors/instance-label';
import { explainMissingCosting, resolveCosting } from './costing-resolution';
import { explainMissingCoding, requireCoding, type PoojaCoding } from './costing-coding';
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
  eventType: { include: { activity: { include: { defaultAccount: true, defaultFund: true } } } },
  slot: { include: { eventType: true } },
  lines: {
    include: { account: true, party: { select: { nameTa: true } } },
    orderBy: { lineNo: 'asc' },
  },
} satisfies Prisma.EventCostingInclude;

export type CostingRow = Prisma.EventCostingGetPayload<{ include: typeof COSTING_INCLUDE }>;

const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/** A Postgres `date` compares against UTC midnight, so that is how one is made. */
const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const dayBefore = (value: Date): Date => new Date(value.getTime() - 86_400_000);

/** An activity's coding, or null where the temple has not set it yet. */
function readCoding(
  activity: { id: number; defaultAccountId: number | null; defaultFundId: number | null } | null,
): PoojaCoding | null {
  if (!activity || activity.defaultAccountId === null || activity.defaultFundId === null) {
    return null;
  }

  return {
    accountId: activity.defaultAccountId,
    fundId: activity.defaultFundId,
    activityId: activity.id,
  };
}

/** Today as a Postgres `date` compares it: UTC midnight. */
const today = (): Date => asDate(isoDate(new Date()));

/** An item's amount follows from its quantity; a heading's is its own. */
const lineAmount = (line: WriteCostingLineDto): Prisma.Decimal =>
  (line.items ?? []).length > 0
    ? (line.items ?? [])
        .reduce(
          (total, item) => total.plus(money(item.quantity).times(money(item.unitAmount))),
          money(0),
        )
        .toDecimalPlaces(2)
    : money(line.amount ?? 0);

/** What resolution needs of a row's status: whether the committee applied it. */
const withStanding = <T extends { status: CostingStatus }>(row: T): T & { isApplied: boolean } => ({
  ...row,
  isApplied: row.status !== CostingStatus.draft,
});

/**
 * What the sponsor is asked for: the lines charged to them, added up.
 *
 * Calculated rather than typed. A quote that can be entered as well as summed
 * is a quote with two answers, and the one nobody checks is the one that ends
 * up on the receipt.
 */
const chargedTotal = (lines: readonly WriteCostingLineDto[]): Prisma.Decimal =>
  lines
    .filter((line) => line.chargedToSponsor ?? true)
    .reduce((total, line) => total.plus(lineAmount(line)), money(0));

@Injectable()
export class EventCostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryCostingsDto): Promise<CostingRecordDto[]> {
    /*
     * Built as a list rather than spread into one object, because both filters
     * now speak about the status and the second spread would have silently won.
     * Asking for what was in force on a date would then have returned drafts.
     */
    const conditions: Prisma.EventCostingWhereInput[] = [];

    // By status, not an open end date: a draft has one of those too, and asking
    // for what is in force must not return what has yet to be.
    if (query.inForce) conditions.push({ status: CostingStatus.inForce });

    if (query.on) {
      const on = asDate(query.on);

      conditions.push(
        { status: { not: CostingStatus.draft } },
        // A null start has always applied, so it covers the date by having no
        // beginning to fall short of.
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: on } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] },
      );
    }

    const costings = await this.prisma.eventCosting.findMany({
      where: {
        eventTypeId: query.eventTypeId,
        slotId: query.slotId,
        ...(conditions.length > 0 ? { AND: conditions } : {}),
      },
      include: COSTING_INCLUDE,
      orderBy: [{ eventTypeId: 'asc' }, { slotId: 'asc' }, { effectiveFrom: 'desc' }],
    });

    const used = await this.usageByCosting(costings.map((costing) => costing.id));

    return costings.map((costing) => this.toRecord(costing, used.get(costing.id) ?? 0));
  }

  /**
   * Every version this scope has had, newest first.
   *
   * The same pooja, the same instance, priced across the years. This is what
   * the temple asked the versions for: the committee revises a rate about every
   * three years, and the question at the year end is what it was before.
   */
  async history(id: number): Promise<CostingRecordDto[]> {
    const costing = await this.load(id);

    const versions = await this.prisma.eventCosting.findMany({
      where: { eventTypeId: costing.eventTypeId, slotId: costing.slotId },
      include: COSTING_INCLUDE,
      orderBy: { effectiveFrom: 'desc' },
    });

    const used = await this.usageByCosting(versions.map((version) => version.id));

    return versions.map((version) => this.toRecord(version, used.get(version.id) ?? 0));
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
      where: { eventTypeId, OR: [{ slotId }, { slotId: null }] },
      include: COSTING_INCLUDE,
    });

    /*
     * Drafts are fetched and then rejected by the rule rather than filtered out
     * of the query. The one piece that decides money should be able to say why
     * it passed a version over, and a row the query never returned is a row no
     * test of that rule can be written against.
     */
    return resolveCosting(candidates.map(withStanding), slotId, on);
  }

  async create(dto: CreateCostingDto, context: ActorContext): Promise<CostingRecordDto> {
    await this.assertScope(dto.eventTypeId, dto.slotId ?? null);

    const coding = await this.codingFor(dto.eventTypeId);
    const lines = dto.lines ?? [];

    await this.assertLineCoding(lines);

    /*
     * A saved costing is a draft and prices nothing yet. Writing one changes no
     * quote and closes no version: it waits until the committee applies it,
     * which is the act that says a figure really did change rather than that
     * somebody was correcting yesterday's typing.
     *
     * The start date is left unset and settled when it is applied. Whether this
     * is the first version of its scope — the case that must have no start, so
     * that a festival kept in August and costed in September is priced by
     * something — is a question about the day it goes into force, not the day
     * it was typed, and a draft may sit unapplied across the arrival of another.
     */
    const effectiveFrom = dto.effectiveFrom ? asDate(dto.effectiveFrom) : null;

    const costing = await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventCosting.create({
        data: {
          eventTypeId: dto.eventTypeId,
          slotId: dto.slotId ?? null,
          effectiveFrom,
          status: CostingStatus.draft,
          sponsorAmount: chargedTotal(lines),
          notes: dto.notes ?? null,
          createdBy: context.actor.id,
        },
      });

      await this.writeLines(tx, created.id, lines, coding);

      return created;
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'event_costing',
      entityRef: String(costing.id),
      // "Drafted", not "Costed": nothing is quoted at this figure until it is
      // applied, and an audit line that says otherwise is the one a year-end
      // reader would take for the moment the rate changed.
      summary:
        `Drafted a costing for ${await this.scopeName(dto.eventTypeId, dto.slotId ?? null)} ` +
        `at ${toRupees(costing.sponsorAmount)}`,
    });

    return this.findOneOrFail(costing.id);
  }

  /**
   * Save a costing. Nothing it says reaches a quote until it is applied.
   *
   * Editing a draft rewrites it in place: it prices nothing, so there is
   * nothing to keep a record of and no version to open. Editing the version in
   * force does not touch it — the figures go to that scope's draft, which is
   * created on the first such save and rewritten by every one after it. The
   * temple goes on quoting the applied version the whole time.
   *
   * This is what a draft is for. A rate the committee revises about every three
   * years is worth a version; a typo noticed the next morning is not, and
   * before there was an act of applying one, the two were indistinguishable —
   * every edit made on a later day opened a version, so the record showed a
   * rate change the temple had never made.
   */
  async update(
    id: number,
    dto: UpdateCostingDto,
    context: ActorContext,
  ): Promise<CostingRecordDto> {
    const before = await this.load(id);

    if (before.status === CostingStatus.superseded) {
      throw new ConflictException(
        'That version was replaced by a later one and is kept as history. ' +
          'Edit the version in force, or copy this one to start again from it',
      );
    }

    if (dto.lines) await this.assertLineCoding(dto.lines);

    const coding = await this.codingFor(before.eventTypeId);
    const lines = dto.lines ?? this.linesFrom(before);
    const quoted = chargedTotal(lines);
    const notes = dto.notes === undefined ? before.notes : (dto.notes ?? null);

    if (before.status === CostingStatus.draft) {
      await this.prisma.$transaction(async (tx) => {
        await tx.eventCosting.update({
          where: { id },
          data: { notes: dto.notes, sponsorAmount: quoted },
        });

        if (dto.lines) {
          await tx.eventCostingLine.deleteMany({ where: { costingId: id } });
          await this.writeLines(tx, id, dto.lines, coding);
        }
      });

      await this.audit.record(context, {
        action: 'update',
        entity: 'event_costing',
        entityRef: String(id),
        summary: `Revised the draft costing for ${this.scopeLabel(before)} to ${toRupees(quoted)}`,
      });

      return this.findOneOrFail(id);
    }

    /*
     * One draft per scope, rewritten rather than added to.
     *
     * Two drafts would put the committee in front of a choice nobody asked for
     * — which of these do you mean? — and the exclusion constraint cannot stop
     * it, because drafts are exactly what it exempts.
     */
    const existing = await this.prisma.eventCosting.findFirst({
      where: {
        eventTypeId: before.eventTypeId,
        slotId: before.slotId,
        status: CostingStatus.draft,
      },
    });

    const draftId = await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.eventCosting.update({
          where: { id: existing.id },
          data: { sponsorAmount: quoted, notes },
        });

        await tx.eventCostingLine.deleteMany({ where: { costingId: existing.id } });
        await this.writeLines(tx, existing.id, lines, coding);

        return existing.id;
      }

      const draft = await tx.eventCosting.create({
        data: {
          eventTypeId: before.eventTypeId,
          slotId: before.slotId,
          // Settled when it is applied, not now: see `create`.
          effectiveFrom: null,
          status: CostingStatus.draft,
          sponsorAmount: quoted,
          notes,
          createdBy: context.actor.id,
        },
      });

      await this.writeLines(tx, draft.id, lines, coding);

      return draft.id;
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_costing',
      entityRef: String(draftId),
      summary:
        `Drafted ${toRupees(quoted)} for ${this.scopeLabel(before)}; ` +
        `costing ${id} stays in force until it is applied`,
    });

    return this.findOneOrFail(draftId);
  }

  /**
   * Put a draft into force, and close the version it replaces.
   *
   * This is the act the whole model turns on. Until it happens the temple
   * quotes what it quoted yesterday; after it, the old figures are history and
   * the year-by-year report reads them as what the rate was until today.
   */
  async apply(id: number, context: ActorContext): Promise<CostingRecordDto> {
    const draft = await this.load(id);

    if (draft.status !== CostingStatus.draft) {
      throw new ConflictException(
        draft.status === CostingStatus.inForce
          ? 'That costing is already in force'
          : 'That version was replaced by a later one and cannot be applied again',
      );
    }

    if (draft.lines.length === 0) {
      throw new BadRequestException(
        'That draft has no expense lines. A costing that prices nothing cannot be applied',
      );
    }

    await this.assertLineCoding(this.linesFrom(draft));

    const predecessor = await this.prisma.eventCosting.findFirst({
      where: {
        eventTypeId: draft.eventTypeId,
        slotId: draft.slotId,
        status: CostingStatus.inForce,
      },
    });

    /*
     * Nothing in force yet, so this one has always applied.
     *
     * It begins nowhere rather than today, which is what lets it price a day
     * already past — a festival kept in August and costed in September. Only a
     * start the committee named itself is kept.
     */
    if (!predecessor) {
      await this.prisma.eventCosting.update({
        where: { id },
        data: { status: CostingStatus.inForce },
      });

      await this.audit.record(context, {
        action: 'update',
        entity: 'event_costing',
        entityRef: String(id),
        summary:
          `Applied the costing for ${this.scopeLabel(draft)} at ` +
          `${toRupees(draft.sponsorAmount)}` +
          (draft.effectiveFrom ? ` from ${isoDate(draft.effectiveFrom)}` : ', applying throughout'),
      });

      return this.findOneOrFail(id);
    }

    /*
     * The version in force began today, so it never priced a day this one will
     * not. Closing it the day before would date it backwards; it is merged into
     * instead, and the draft goes. A morning of revising is one act, exactly as
     * a morning of typing was.
     */
    const sameDay =
      predecessor.effectiveFrom !== null && isoDate(predecessor.effectiveFrom) >= isoDate(today());

    const appliedId = await this.prisma.$transaction(async (tx) => {
      if (sameDay) {
        await tx.eventCosting.update({
          where: { id: predecessor.id },
          data: { sponsorAmount: draft.sponsorAmount, notes: draft.notes },
        });

        await tx.eventCostingLine.deleteMany({ where: { costingId: predecessor.id } });
        await this.writeLines(
          tx,
          predecessor.id,
          this.linesFrom(draft),
          await this.codingFor(draft.eventTypeId),
        );

        await tx.eventCosting.delete({ where: { id } });

        return predecessor.id;
      }

      await tx.eventCosting.update({
        where: { id: predecessor.id },
        data: { effectiveTo: dayBefore(today()), status: CostingStatus.superseded },
      });

      await tx.eventCosting.update({
        where: { id },
        data: { effectiveFrom: draft.effectiveFrom ?? today(), status: CostingStatus.inForce },
      });

      return id;
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_costing',
      entityRef: String(appliedId),
      summary: sameDay
        ? `Applied ${toRupees(draft.sponsorAmount)} to today's costing for ${this.scopeLabel(draft)}`
        : `Applied ${toRupees(draft.sponsorAmount)} for ${this.scopeLabel(draft)} from ` +
          `${isoDate(today())}; costing ${predecessor.id} kept as what it was before`,
    });

    return this.findOneOrFail(appliedId);
  }

  /**
   * Day two of a festival is day one with three figures changed.
   *
   * The copy carries every line and its itemisation onto the slot named, so the
   * work left is correcting what differs rather than retyping what does not.
   */
  async copy(id: number, dto: CopyCostingDto, context: ActorContext): Promise<CostingRecordDto> {
    const source = await this.load(id);
    const slotId = dto.slotId ?? null;

    await this.assertScope(source.eventTypeId, slotId);

    const created = await this.create(
      {
        eventTypeId: source.eventTypeId,
        slotId,
        effectiveFrom: dto.effectiveFrom,
        notes: source.notes,
        lines: this.linesFrom(source),
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

  /**
   * Delete a costing that never priced anything.
   *
   * Two rows qualify and no others. A draft was never applied, so nothing was
   * ever quoted from it — throwing away a revision the committee decided
   * against is the ordinary end of one. A costing with no expense lines priced
   * nothing even if it was applied: it is the empty row left behind when a
   * scope was created and never filled in.
   *
   * Everything else stays. Once a costing has been applied with figures on it,
   * it is the answer to what this pooja cost while it was in force, and that
   * question does not stop being asked because the rate has since changed. The
   * way to change it is to edit it and apply a new version, which keeps this
   * one as the record of what came before.
   */
  async remove(id: number, context: ActorContext): Promise<void> {
    const costing = await this.load(id);
    const isDraft = costing.status === CostingStatus.draft;

    if (!isDraft && costing.lines.length > 0) {
      throw new ConflictException(
        costing.status === CostingStatus.superseded
          ? 'That version was replaced by a later one. It is the answer to what this ' +
              'pooja cost that year, and the year-by-year report is read from it'
          : 'That costing is in force and is what this pooja is quoted at. Edit it and ' +
              'apply a new version; the figures it has now are kept as what they were',
      );
    }

    /*
     * An occurrence pointing at this one loses the pointer and nothing else.
     * `events.costing_id` is provenance — the column's own comment says it is
     * never read back — and the day's budget is resolved from the version in
     * force on its date, not from anything stored on the day.
     */
    await this.prisma.eventCosting.delete({ where: { id } });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'event_costing',
      entityRef: String(id),
      summary: isDraft
        ? `Discarded the draft costing for ${this.scopeLabel(costing)}`
        : `Removed the empty costing for ${this.scopeLabel(costing)}`,
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────

  /**
   * Headings first, then the items under each.
   *
   * The fund and the activity are not written from the form — they are the
   * pooja type's own, carried down onto every line so that a report never has
   * to ask the costing where its money is held. An item's amount follows from
   * its quantity and unit price; a heading with items is their sum.
   */
  private async writeLines(
    tx: Prisma.TransactionClient,
    costingId: number,
    lines: readonly WriteCostingLineDto[],
    coding: PoojaCoding,
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
          fundId: coding.fundId,
          activityId: coding.activityId,
          partyId: heading.partyId ?? null,
          amount: lineAmount(heading),
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
            fundId: coding.fundId,
            activityId: coding.activityId,
            partyId: heading.partyId ?? null,
            amount: money(item.quantity).times(money(item.unitAmount)).toDecimalPlaces(2),
            quantity: item.quantity,
            unitAmount: item.unitAmount,
            chargedToSponsor: heading.chargedToSponsor ?? true,
          },
        });
      }
    }
  }

  /** A stored costing's lines, in the shape they are written back in. */
  private linesFrom(costing: CostingRow): WriteCostingLineDto[] {
    return costing.lines
      .filter((line) => line.parentLineId === null)
      .map((heading) => ({
        accountId: heading.accountId,
        partyId: heading.partyId,
        label: heading.label,
        amount: toRupees(heading.amount),
        chargedToSponsor: heading.chargedToSponsor,
        items: costing.lines
          .filter((line) => line.parentLineId === heading.id)
          .map((item) => ({
            label: item.label ?? '',
            quantity: toRupees(item.quantity ?? 0),
            unitAmount: toRupees(item.unitAmount ?? 0),
          })),
      }));
  }

  /**
   * The head and fund a pooja's money is coded to, read from its activity.
   *
   * Null when the temple has not answered it yet, which the screens report
   * rather than guess at: coding a sponsor's receipt to the wrong head is the
   * kind of mistake that is only found at the year end.
   */
  async codingFor(eventTypeId: number): Promise<PoojaCoding> {
    const type = await this.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      include: { activity: true },
    });

    if (!type) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    return requireCoding(readCoding(type.activity), type.nameTa, type.activityId !== null);
  }

  // ── rules ─────────────────────────────────────────────────────────────────

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

      if (line.partyId) {
        const party = await this.prisma.party.findUnique({ where: { id: line.partyId } });

        if (!party) throw new NotFoundException(`Party ${line.partyId} was not found${where}`);
        if (!party.isActive) {
          throw new BadRequestException(`${party.nameTa} is no longer active${where}`);
        }
      }
    }
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

  /** The scope in words, before a costing row exists to read it from. */
  private async scopeName(eventTypeId: number, slotId: number | null): Promise<string> {
    const type = await this.prisma.eventType.findUnique({ where: { id: eventTypeId } });

    if (!slotId) return type?.nameTa ?? `Event type ${eventTypeId}`;

    const slot = await this.prisma.eventSlot.findUnique({
      where: { id: slotId },
      include: { eventType: true },
    });

    if (!slot) return type?.nameTa ?? `Event type ${eventTypeId}`;

    return `${slot.eventType.nameTa} — ${describeInstance(
      slot.eventType.frequencyType,
      slot.instanceIdentifier,
      slot.customInstanceName,
    )}`;
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
    const chargedSum = headings
      .filter((line) => line.chargedToSponsor)
      .reduce((total, line) => total.plus(line.amount), money(0));

    const coding = readCoding(costing.eventType.activity);
    const activity = costing.eventType.activity;

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
      effectiveFrom: costing.effectiveFrom ? isoDate(costing.effectiveFrom) : null,
      effectiveTo: costing.effectiveTo ? isoDate(costing.effectiveTo) : null,
      status: costing.status,
      isDraft: costing.status === CostingStatus.draft,
      // Read from the status, not from an open end date: a draft has no end
      // either, and before there were drafts that was a safe thing to confuse.
      isInForce: costing.status === CostingStatus.inForce,
      sponsorAmount: toRupees(costing.sponsorAmount),
      incomeAccountId: coding?.accountId ?? null,
      incomeAccountName: activity?.defaultAccount
        ? `${activity.defaultAccount.code} · ${activity.defaultAccount.nameEn ?? activity.defaultAccount.nameTa}`
        : null,
      incomeFundId: coding?.fundId ?? null,
      codingProblem: coding
        ? null
        : explainMissingCoding(costing.eventType.nameTa, costing.eventType.activityId !== null),
      notes: costing.notes,
      lines: headings.map((heading) => this.toLine(heading, costing.lines)),
      expenseTotal: toRupees(expenseTotal),
      chargedTotal: toRupees(chargedSum),
      templeShare: toRupees(expenseTotal.minus(chargedSum)),
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
        quantity: toRupees(item.quantity ?? 0),
        unitAmount: toRupees(item.unitAmount ?? 0),
        amount: toRupees(item.amount),
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
