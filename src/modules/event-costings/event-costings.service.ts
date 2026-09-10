import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { money, toRupees } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType } from '../../generated/prisma/enums';
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

type CostingRow = Prisma.EventCostingGetPayload<{ include: typeof COSTING_INCLUDE }>;

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
    const costings = await this.prisma.eventCosting.findMany({
      where: {
        eventTypeId: query.eventTypeId,
        slotId: query.slotId,
        ...(query.inForce ? { effectiveTo: null } : {}),
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

    return resolveCosting(candidates, slotId, on);
  }

  async create(dto: CreateCostingDto, context: ActorContext): Promise<CostingRecordDto> {
    await this.assertScope(dto.eventTypeId, dto.slotId ?? null);

    const coding = await this.codingFor(dto.eventTypeId);
    const lines = dto.lines ?? [];

    await this.assertLineCoding(lines);

    /*
     * A saved costing is in force from the day it is saved. There is no draft
     * and nothing to switch on: what is written applies, until the day it is
     * revised. Anything already dated before that keeps the figures it was
     * quoted at, because those live on the occurrence, not here.
     */
    const costing = await this.prisma.$transaction(async (tx) => {
      const created = await tx.eventCosting.create({
        data: {
          eventTypeId: dto.eventTypeId,
          slotId: dto.slotId ?? null,
          effectiveFrom: dto.effectiveFrom ? asDate(dto.effectiveFrom) : today(),
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
        `Costed ${await this.scopeName(dto.eventTypeId, dto.slotId ?? null)} at ` +
        `${toRupees(costing.sponsorAmount)} from ${isoDate(costing.effectiveFrom)}`,
    });

    return this.findOneOrFail(costing.id);
  }

  /**
   * Revise a costing, versioning it where it has already been quoted from.
   *
   * Nothing is put into force and nothing is switched over. A costing nobody
   * has used yet is simply corrected. One that has priced an occurrence is
   * closed the day before today and its successor opened today, so that the
   * family quoted last year goes on being owed what they were told while every
   * date from here reads the new figure. The temple asked for one act — save —
   * and this is what has to happen underneath for that act to be honest.
   */
  async update(
    id: number,
    dto: UpdateCostingDto,
    context: ActorContext,
  ): Promise<CostingRecordDto> {
    const before = await this.load(id);

    if (before.effectiveTo !== null) {
      throw new ConflictException(
        'That version was replaced by a later one and is kept as history. ' +
          'Edit the version in force, or copy this one to start again from it',
      );
    }

    if (dto.lines) await this.assertLineCoding(dto.lines);

    const coding = await this.codingFor(before.eventTypeId);
    const lines = dto.lines ?? this.linesFrom(before);
    const quoted = chargedTotal(lines);

    const used = await this.usage(id);
    const startedToday = isoDate(before.effectiveFrom) >= isoDate(today());

    /*
     * Same-day corrections stay in place even once something has been costed
     * from them: the version has nowhere to be closed to that would not overlap
     * its successor, and a costing still being set up this morning is being
     * corrected rather than revised.
     */
    const versions = used > 0 && !startedToday;

    const targetId = await this.prisma.$transaction(async (tx) => {
      if (!versions) {
        await tx.eventCosting.update({
          where: { id },
          data: { notes: dto.notes, sponsorAmount: quoted },
        });

        if (dto.lines) {
          await tx.eventCostingLine.deleteMany({ where: { costingId: id } });
          await this.writeLines(tx, id, dto.lines, coding);
        }

        return id;
      }

      await tx.eventCosting.update({
        where: { id },
        data: { effectiveTo: dayBefore(today()) },
      });

      const successor = await tx.eventCosting.create({
        data: {
          eventTypeId: before.eventTypeId,
          slotId: before.slotId,
          effectiveFrom: today(),
          sponsorAmount: quoted,
          notes: dto.notes === undefined ? before.notes : (dto.notes ?? null),
          createdBy: context.actor.id,
        },
      });

      await this.writeLines(tx, successor.id, lines, coding);

      return successor.id;
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_costing',
      entityRef: String(targetId),
      summary: versions
        ? `Revised ${this.scopeLabel(before)} to ${toRupees(quoted)} from ${isoDate(today())}; ` +
          `costing ${id} kept as history for the ${used} occurrence(s) quoted from it`
        : `Corrected the costing for ${this.scopeLabel(before)} to ${toRupees(quoted)}`,
    });

    return this.findOneOrFail(targetId);
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
        effectiveFrom: dto.effectiveFrom ?? isoDate(today()),
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

  async remove(id: number, context: ActorContext): Promise<void> {
    const costing = await this.load(id);
    const used = await this.usage(id);

    if (used > 0) {
      throw new ConflictException(
        `${used} occurrence(s) were costed from this version; it is history and cannot be removed`,
      );
    }

    if (costing.effectiveTo !== null) {
      throw new ConflictException(
        'That version was replaced by a later one. It is the answer to what this ' +
          'pooja cost that year, and the year-by-year report is read from it',
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
      effectiveFrom: isoDate(costing.effectiveFrom),
      effectiveTo: costing.effectiveTo ? isoDate(costing.effectiveTo) : null,
      // Nothing switches a costing on: the one still open is the one in force.
      isInForce: costing.effectiveTo === null,
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
