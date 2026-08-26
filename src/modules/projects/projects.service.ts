import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { share, toRupees, toRupeesOrNull } from '../../common/money/money';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { ProjectStatusWire } from '../../common/enums/wire';
import { AccountType, ProjectStatus } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import {
  CreateProjectDto,
  ProjectRecordDto,
  ProjectRefDto,
  QueryProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';

type ProjectRow = Prisma.ProjectGetPayload<{ include: { fund: true } }>;

export function toProjectRef(project: {
  id: number;
  nameTa: string;
  nameEn: string | null;
  fundId: number;
  isActive: boolean;
}): ProjectRefDto {
  return {
    id: project.id,
    name: project.nameEn ?? project.nameTa,
    fundId: project.fundId,
    isActive: project.isActive,
  };
}

interface Movement {
  spent: number;
  received: number;
  entryCount: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryProjectsDto): Promise<ProjectRecordDto[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        fundId: query.fundId,
        status: ProjectStatusWire.toPrismaOptional(query.status),
        isActive: query.isActive,
      },
      include: { fund: true },
      orderBy: { startDate: 'desc' },
    });

    const movement = await this.movementByProject(query.financialYearId);

    return projects.map((project) => this.toRecord(project, movement.get(project.id)));
  }

  async findOneOrFail(id: number, financialYearId?: number): Promise<ProjectRecordDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { fund: true },
    });

    if (!project) throw new NotFoundException(`Project ${id} was not found`);

    const movement = await this.movementByProject(financialYearId);

    return this.toRecord(project, movement.get(id));
  }

  /** Throws unless the project exists and still accepts entries. */
  async assertPostable(id: number, fundId: number): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id } });

    if (!project) throw new NotFoundException(`Project ${id} was not found`);
    if (!project.isActive) {
      throw new BadRequestException('That project is closed to new entries');
    }
    if (project.fundId !== fundId) {
      throw new BadRequestException('The project belongs to a different fund than the voucher');
    }
  }

  async create(dto: CreateProjectDto, context: ActorContext): Promise<ProjectRecordDto> {
    await this.assertFundIsActive(dto.fundId);

    const project = await this.prisma.project.create({
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        fundId: dto.fundId,
        budget: dto.budget,
        startDate: new Date(dto.startDate),
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        status: ProjectStatusWire.toPrismaOptional(dto.status) ?? ProjectStatus.planning,
        description: dto.description ?? '',
      },
      include: { fund: true },
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'project',
      entityRef: String(project.id),
      summary: `Created project ${project.nameTa} under ${project.fund.nameTa}`,
    });

    return this.findOneOrFail(project.id);
  }

  async update(
    id: number,
    dto: UpdateProjectDto,
    context: ActorContext,
  ): Promise<ProjectRecordDto> {
    const before = await this.prisma.project.findUnique({ where: { id }, include: { fund: true } });

    if (!before) throw new NotFoundException(`Project ${id} was not found`);

    if (dto.fundId !== undefined && dto.fundId !== before.fundId) {
      const entries = await this.prisma.ledgerEntry.count({ where: { projectId: id } });

      if (entries > 0) {
        throw new ConflictException(
          'This project already has posted entries against its fund and cannot be moved',
        );
      }

      await this.assertFundIsActive(dto.fundId);
    }

    const project = await this.prisma.project.update({
      where: { id },
      data: {
        nameTa: dto.nameTa,
        nameEn: dto.nameEn,
        fundId: dto.fundId,
        budget: dto.budget,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        status: ProjectStatusWire.toPrismaOptional(dto.status),
        description: dto.description,
        isActive: dto.isActive ?? this.activityFor(ProjectStatusWire.toPrismaOptional(dto.status)),
      },
      include: { fund: true },
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'project',
      entityRef: String(id),
      summary: `Updated project ${project.nameTa}`,
      diff: AuditService.diff(
        { ...before, budget: toRupeesOrNull(before.budget), fund: undefined },
        { ...project, budget: toRupeesOrNull(project.budget), fund: undefined },
      ),
    });

    return this.findOneOrFail(id);
  }

  async close(id: number, context: ActorContext): Promise<ProjectRecordDto> {
    return this.update(id, { status: 'completed', isActive: false }, context);
  }

  /**
   * Work that is on hold or completed stops taking entries but keeps its history,
   * so `isActive` follows `status` unless the caller says otherwise.
   */
  private activityFor(status: ProjectStatus | undefined): boolean | undefined {
    if (status === undefined) return undefined;

    return status === ProjectStatus.planning || status === ProjectStatus.active;
  }

  private async assertFundIsActive(fundId: number): Promise<void> {
    const fund = await this.prisma.fund.findUnique({ where: { id: fundId } });

    if (!fund) throw new NotFoundException(`Fund ${fundId} was not found`);
    if (!fund.isActive) throw new BadRequestException(`Fund ${fund.nameTa} is closed`);
  }

  private async movementByProject(financialYearId?: number): Promise<Map<number, Movement>> {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['projectId', 'accountId'],
      where: { ...this.ledger.postedIn(financialYearId), projectId: { not: null } },
      _sum: { debit: true, credit: true },
      _count: { _all: true },
    });

    if (rows.length === 0) return new Map();

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.accountId))] } },
      select: { id: true, type: true },
    });

    const typeOf = new Map(accounts.map((account) => [account.id, account.type]));
    const movement = new Map<number, Movement>();

    for (const row of rows) {
      if (row.projectId === null) continue;

      const current = movement.get(row.projectId) ?? { spent: 0, received: 0, entryCount: 0 };
      const type = typeOf.get(row.accountId);
      const debit = toRupees(row._sum.debit);
      const credit = toRupees(row._sum.credit);

      if (type === AccountType.expense) current.spent += debit - credit;
      if (type === AccountType.income) current.received += credit - debit;
      current.entryCount += row._count._all;

      movement.set(row.projectId, current);
    }

    return movement;
  }

  private toRecord(project: ProjectRow, movement: Movement | undefined): ProjectRecordDto {
    const { spent, received, entryCount } = movement ?? { spent: 0, received: 0, entryCount: 0 };
    const budget = toRupeesOrNull(project.budget);
    const round = (value: number) => Math.round(value * 100) / 100;

    return {
      ...toProjectRef(project),
      nameTa: project.nameTa,
      budget,
      startDate: project.startDate.toISOString().slice(0, 10),
      targetDate: project.targetDate?.toISOString().slice(0, 10) ?? null,
      status: ProjectStatusWire.toWire(project.status),
      description: project.description,
      fundName: project.fund.nameEn ?? project.fund.nameTa,
      spent: round(spent),
      received: round(received),
      remaining: budget === null ? null : round(budget - spent),
      utilisation: budget === null ? null : share(spent, budget),
      isOverBudget: budget !== null && spent > budget,
      entryCount,
    };
  }
}
