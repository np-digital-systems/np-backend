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
import { explainMissingCosting, resolveCosting, templeDay } from './costing-resolution';
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

const utcMidnight = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

// A named date means the start of that day in Colombo, not UTC midnight.
const asDate = (value: string): Date => templeDay(utcMidnight(value)).from;

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

// A heading with items is their sum; otherwise its own amount.
const lineAmount = (line: WriteCostingLineDto): Prisma.Decimal =>
  (line.items ?? []).length > 0
    ? (line.items ?? [])
        .reduce((total, item) => total.plus(money(item.amount)), money(0))
        .toDecimalPlaces(2)
    : money(line.amount ?? 0);

const withStanding = <T extends { status: CostingStatus }>(row: T): T & { isApplied: boolean } => ({
  ...row,
  isApplied: row.status !== CostingStatus.draft,
});

// The sponsor's quote is always derived from the charged lines, never entered.
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
    // A list, not spread objects: both filters set `status`, and a spread would overwrite one.
    const conditions: Prisma.EventCostingWhereInput[] = [];

    // By status, not open end date: drafts have an open end date too.
    if (query.inForce) conditions.push({ status: CostingStatus.inForce });

    if (query.on) {
      // Compare against the temple day's bounds: versions start at instants, not midnight.
      const day = templeDay(utcMidnight(query.on));

      conditions.push(
        { status: { not: CostingStatus.draft } },
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lt: day.to } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: day.from } }] },
      );
    }

    const costings = await this.prisma.eventCosting.findMany({
      where: {
        eventTypeId: query.eventTypeId,
        slotId: query.slotId,
        ...(conditions.length > 0 ? { AND: conditions } : {}),
      },
      include: COSTING_INCLUDE,
      // By version, not start date: version 1 has a null start, which Postgres sorts first on DESC.
      orderBy: [
        { eventTypeId: 'asc' },
        { slotId: 'asc' },
        { versionNo: { sort: 'desc', nulls: 'first' } },
      ],
    });

    const used = await this.usageByCosting(costings.map((costing) => costing.id));

    return costings.map((costing) => this.toRecord(costing, used.get(costing.id) ?? 0));
  }

  async history(id: number): Promise<CostingRecordDto[]> {
    const costing = await this.load(id);

    const versions = await this.prisma.eventCosting.findMany({
      where: { eventTypeId: costing.eventTypeId, slotId: costing.slotId },
      include: COSTING_INCLUDE,
      // Draft first, then newest version (see findMany for why not by date).
      orderBy: { versionNo: { sort: 'desc', nulls: 'first' } },
    });

    const used = await this.usageByCosting(versions.map((version) => version.id));

    return versions.map((version) => this.toRecord(version, used.get(version.id) ?? 0));
  }

  async findOneOrFail(id: number): Promise<CostingRecordDto> {
    const costing = await this.load(id);

    return this.toRecord(costing, await this.usage(id));
  }

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

  async applicableTo(eventTypeId: number, slotId: number, on: Date): Promise<CostingRow | null> {
    const candidates = await this.prisma.eventCosting.findMany({
      where: { eventTypeId, OR: [{ slotId }, { slotId: null }] },
      include: COSTING_INCLUDE,
    });

    // Drafts are filtered by resolveCosting, not the query, so that rule stays testable in one place.
    return resolveCosting(candidates.map(withStanding), slotId, on);
  }

  async create(dto: CreateCostingDto, context: ActorContext): Promise<CostingRecordDto> {
    await this.assertScope(dto.eventTypeId, dto.slotId ?? null);

    const coding = await this.codingFor(dto.eventTypeId);
    const lines = dto.lines ?? [];

    await this.assertLineCoding(lines);

    // Saved as a draft that prices nothing. The start is settled on apply, since whether it's
    // the scope's first version (no start) depends on when it goes into force.
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
      summary:
        `Drafted a costing for ${await this.scopeName(dto.eventTypeId, dto.slotId ?? null)} ` +
        `at ${toRupees(costing.sponsorAmount)}`,
    });

    return this.findOneOrFail(costing.id);
  }

  // Editing a draft rewrites it. Editing the version in force leaves it untouched and writes to
  // the scope's draft instead (created on first save), so quotes don't change until applied.
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

    // One draft per scope. Enforced here because the exclusion constraint exempts drafts.
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
          // Settled on apply; see create.
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

  // Puts a draft into force and supersedes the current version. Each apply is its own numbered
  // version; periods are instants so several applies on one day are all kept.
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

    // Count applied versions rather than predecessor + 1, so a deleted empty version can't cause a duplicate number.
    const applied = await this.prisma.eventCosting.count({
      where: {
        eventTypeId: draft.eventTypeId,
        slotId: draft.slotId,
        status: { not: CostingStatus.draft },
      },
    });

    const versionNo = applied + 1;

    // Reject a draft identical to the version in force; the UI also blocks it, but this is the real guard.
    if (predecessor && (await this.matches(predecessor.id, draft))) {
      throw new ConflictException(
        `That draft is the same as version ${predecessor.versionNo ?? '?'}, which is already ` +
          'in force. Change a figure before applying it',
      );
    }

    // One instant ends the predecessor and starts this version, so the periods meet with no gap.
    const at = new Date();

    const appliedId = await this.prisma.$transaction(async (tx) => {
      if (predecessor) {
        await tx.eventCosting.update({
          where: { id: predecessor.id },
          data: { effectiveTo: at, status: CostingStatus.superseded },
        });
      }

      await tx.eventCosting.update({
        where: { id },
        data: {
          // A first version keeps a null start (always applied) unless one was named explicitly.
          effectiveFrom: predecessor ? (draft.effectiveFrom ?? at) : draft.effectiveFrom,
          status: CostingStatus.inForce,
          versionNo,
        },
      });

      return id;
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_costing',
      entityRef: String(appliedId),
      summary: predecessor
        ? `Applied version ${versionNo} of ${this.scopeLabel(draft)} at ` +
          `${toRupees(draft.sponsorAmount)}; version ${predecessor.versionNo ?? '?'} closed`
        : `Applied version ${versionNo} of ${this.scopeLabel(draft)} at ` +
          `${toRupees(draft.sponsorAmount)}, applying throughout`,
    });

    return this.findOneOrFail(appliedId);
  }

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

  // Only drafts and empty costings can be deleted; an applied costing with lines is the record of what the pooja cost.
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

    // Events referencing it only lose `costing_id` (provenance only); budgets are resolved by date.
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

  // Fund and activity come from the pooja type and are copied onto every line for reporting.
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
            amount: money(item.amount).toDecimalPlaces(2),
            chargedToSponsor: heading.chargedToSponsor ?? true,
          },
        });
      }
    }
  }

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
            amount: toRupees(item.amount),
          })),
      }));
  }

  private async codingFor(eventTypeId: number): Promise<PoojaCoding> {
    const type = await this.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      include: { activity: true },
    });

    if (!type) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    return requireCoding(readCoding(type.activity), type.nameTa, type.activityId !== null);
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

  // Compares decided content (heads, amounts, payee, itemisation, notes), ignoring ids and line numbers.
  private async matches(againstId: number, draft: CostingRow): Promise<boolean> {
    const against = await this.load(againstId);

    if (!against.sponsorAmount.equals(draft.sponsorAmount)) return false;

    const shape = (costing: CostingRow) =>
      JSON.stringify(
        costing.lines
          .map((line) => ({
            parent: line.parentLineId === null,
            label: line.label,
            accountId: line.accountId,
            amount: line.amount.toFixed(2),
            partyId: line.partyId,
            chargedToSponsor: line.chargedToSponsor,
          }))
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      );

    return shape(against) === shape(draft) && against.notes === draft.notes;
  }

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

  // Headings only; items are a breakdown of their heading.
  private headingTotal(lines: CostingRow['lines']): Prisma.Decimal {
    return lines
      .filter((line) => line.parentLineId === null)
      .reduce((total, line) => total.plus(line.amount), money(0));
  }

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
      // Full instants: several versions can share a day.
      effectiveFrom: costing.effectiveFrom ? costing.effectiveFrom.toISOString() : null,
      effectiveTo: costing.effectiveTo ? costing.effectiveTo.toISOString() : null,
      versionNo: costing.versionNo,
      status: costing.status,
      isDraft: costing.status === CostingStatus.draft,
      // From status, not open end date: drafts have no end date either.
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
