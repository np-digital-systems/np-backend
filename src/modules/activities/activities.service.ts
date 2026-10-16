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

// Activities apply to both income and expense, so a pooja's income and costs can be reported together.
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
        defaultAccountId: dto.defaultAccountId ?? null,
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

    // Validate the resulting row, not just the request, so fund and project can't end up mismatched.
    const defaultFundId =
      dto.defaultFundId === undefined ? before.defaultFundId : (dto.defaultFundId ?? null);
    const defaultProjectId =
      dto.defaultProjectId === undefined ? before.defaultProjectId : (dto.defaultProjectId ?? null);
    const defaultPartyId =
      dto.defaultPartyId === undefined ? before.defaultPartyId : (dto.defaultPartyId ?? null);
    const defaultAccountId =
      dto.defaultAccountId === undefined ? before.defaultAccountId : (dto.defaultAccountId ?? null);

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
        defaultAccountId,
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

  // Activities with posted entries are deactivated, never deleted, so past reports stay valid.
  private async assertNothingDependsOnIt(id: number, nameTa: string): Promise<void> {
    const eventTypes = await this.prisma.eventType.count({ where: { activityId: id } });

    if (eventTypes > 0) {
      throw new ConflictException(
        `${nameTa} is still the activity for ${eventTypes} pooja type(s); point those elsewhere first`,
      );
    }
  }

  // A project belongs to one fund, so the default project must be in the default fund.
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

    // Each side in its natural direction, so both are positive.
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
      defaultAccountId: activity.defaultAccountId,
      isActive: activity.isActive,
      entryCount,
      income: round(earned),
      expenses: round(spent),
      net: round(earned - spent),
    };
  }
}
