import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AccountType } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService, type Sides } from '../ledger/ledger-query.service';
import {
  ActivityRecordDto,
  CreateActivityDto,
  QueryActivitiesDto,
  UpdateActivityDto,
} from './dto/activity.dto';

type ActivityRow = Prisma.ActivityGetPayload<Record<string, never>>;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Activities — what an entry was for.
 *
 * The one dimension that sits on both sides of the books, which is what lets a
 * pooja be read whole: sponsorship in against priest time out. An income head
 * can only ever show the money coming in.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryActivitiesDto): Promise<ActivityRecordDto[]> {
    const activities = await this.prisma.activity.findMany({
      where: {
        kind: query.kind,
        isActive: query.isActive,
        OR: query.search
          ? [
              { nameTa: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      orderBy: [{ kind: 'asc' }, { nameTa: 'asc' }],
    });

    const totals = await this.ledger.byDimensionAndType('activityId', query.financialYearId);

    return activities.map((activity) => this.toRecord(activity, totals.get(activity.id)));
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<ActivityRecordDto> {
    const activity = await this.prisma.activity.findUnique({ where: { id } });

    if (!activity) throw new NotFoundException(`Activity ${id} was not found`);

    const totals = await this.ledger.byDimensionAndType('activityId', financialYearId);

    return this.toRecord(activity, totals.get(id));
  }

  async create(dto: CreateActivityDto, context: ActorContext): Promise<ActivityRecordDto> {
    await this.assertCodingIsUsable(
      dto.defaultFundId ?? null,
      dto.defaultProjectId ?? null,
      dto.defaultPartyId ?? null,
    );

    const activity = await this.prisma.activity.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        kind: dto.kind,
        defaultFundId: dto.defaultFundId ?? null,
        defaultProjectId: dto.defaultProjectId ?? null,
        defaultPartyId: dto.defaultPartyId ?? null,
      },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'activity',
      entityRef: String(activity.id),
      summary: `Added activity ${activity.nameTa}`,
    });

    return this.findOneOrFail(activity.id);
  }

  async update(
    id: number,
    dto: UpdateActivityDto,
    context: ActorContext,
  ): Promise<ActivityRecordDto> {
    const before = await this.prisma.activity.findUnique({ where: { id } });

    if (!before) throw new NotFoundException(`Activity ${id} was not found`);

    /*
     * Checked against what the row will hold, not what the request carried:
     * moving the fund alone still has to be checked against the project already
     * on the activity, or the pair could be left pointing at different funds.
     */
    const defaultFundId =
      dto.defaultFundId === undefined ? before.defaultFundId : (dto.defaultFundId ?? null);
    const defaultProjectId =
      dto.defaultProjectId === undefined ? before.defaultProjectId : (dto.defaultProjectId ?? null);
    const defaultPartyId =
      dto.defaultPartyId === undefined ? before.defaultPartyId : (dto.defaultPartyId ?? null);

    await this.assertCodingIsUsable(defaultFundId, defaultProjectId, defaultPartyId);

    if (dto.isActive === false) await this.assertNothingDependsOnIt(id, before.nameTa);

    const activity = await this.prisma.activity.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        kind: dto.kind,
        defaultFundId,
        defaultProjectId,
        defaultPartyId,
        isActive: dto.isActive,
      },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'activity',
      entityRef: String(id),
      summary: `Updated activity ${activity.nameTa}`,
      diff: AuditService.diff(before, activity),
    });

    return this.findOneOrFail(id);
  }

  async deactivate(id: number, context: ActorContext): Promise<ActivityRecordDto> {
    return this.update(id, { isActive: false }, context);
  }

  /*
   * An activity with posted entries is never removed — the entries name it, and
   * a statement that has been read has to keep meaning what it said. Closing a
   * pooja therefore means deactivating it, which keeps it out of the pickers
   * while leaving every report that mentions it intact.
   */
  private async assertNothingDependsOnIt(id: number, nameTa: string): Promise<void> {
    const eventTypes = await this.prisma.eventType.count({ where: { activityId: id } });

    if (eventTypes > 0) {
      throw new ConflictException(
        `${nameTa} is still the activity for ${eventTypes} pooja type(s); point those elsewhere first`,
      );
    }
  }

  /**
   * The three defaults have to make sense together.
   *
   * A project belongs to exactly one fund, so an activity offering both must
   * offer a pair that agree — otherwise picking the activity would fill a
   * voucher with a project the fund does not carry, and the clerk would have
   * to notice before the API refused it.
   */
  private async assertCodingIsUsable(
    fundId: number | null,
    projectId: number | null,
    partyId: number | null,
  ): Promise<void> {
    if (fundId !== null) {
      const fund = await this.prisma.fund.findUnique({ where: { id: fundId } });

      if (!fund) throw new NotFoundException(`Fund ${fundId} was not found`);
      if (!fund.isActive) throw new ConflictException(`Fund ${fund.nameTa} is closed`);
    }

    if (projectId !== null) {
      if (fundId === null) {
        throw new ConflictException('A default project needs the fund it is carried in');
      }

      const project = await this.prisma.project.findUnique({ where: { id: projectId } });

      if (!project) throw new NotFoundException(`Project ${projectId} was not found`);

      if (project.fundId !== fundId) {
        throw new ConflictException(`${project.nameTa} is not carried in the fund chosen above`);
      }
    }

    if (partyId !== null) {
      const party = await this.prisma.party.findUnique({ where: { id: partyId } });

      if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
      if (!party.isActive) throw new ConflictException(`${party.nameTa} is no longer active`);
    }
  }

  private toRecord(
    activity: ActivityRow,
    totals: Map<AccountType, Sides> | undefined,
  ): ActivityRecordDto {
    const income = totals?.get(AccountType.income);
    const expense = totals?.get(AccountType.expense);

    // Each side is read in its own natural direction, so both come out
    // positive and the difference between them means what it looks like.
    const earned = income ? income.credit - income.debit : 0;
    const spent = expense ? expense.debit - expense.credit : 0;

    let entryCount = 0;
    for (const sides of totals?.values() ?? []) entryCount += sides.count;

    return {
      id: activity.id,
      name: activity.nameTa,
      nameEn: activity.nameEn ?? '',
      kind: activity.kind,
      defaultFundId: activity.defaultFundId,
      defaultProjectId: activity.defaultProjectId,
      defaultPartyId: activity.defaultPartyId,
      isActive: activity.isActive,
      entryCount,
      income: round(earned),
      expenses: round(spent),
      net: round(earned - spent),
    };
  }
}
