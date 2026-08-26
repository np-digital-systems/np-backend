import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateSponsorDto,
  QueryDirectoryDto,
  QuerySponsorsDto,
  SponsorAssignmentDto,
  SponsorUserDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import { describeInstance } from './instance-label';

const SPONSOR_SELECT = {
  id: true,
  nameTa: true,
  fullName: true,
  email: true,
  phone: true,
  address: true,
} satisfies Prisma.UserSelect;

type SponsorRow = Prisma.UserGetPayload<{ select: typeof SPONSOR_SELECT }>;

const ASSIGNMENT_INCLUDE = {
  eventType: true,
  user: { select: SPONSOR_SELECT },
} satisfies Prisma.EventTypeSponsorInclude;

@Injectable()
export class SponsorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async directory(
    query: QueryDirectoryDto,
    canSeeContact: boolean,
  ): Promise<PageDto<SponsorUserDto>> {
    const where: Prisma.UserWhereInput = {
      isActive: true,
      OR: query.search
        ? [
            { nameTa: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { memberNo: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: SPONSOR_SELECT,
        orderBy: [{ fullName: 'asc' }, { nameTa: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => this.toSponsor(row, canSeeContact)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async findMany(query: QuerySponsorsDto, canSeeContact: boolean): Promise<SponsorAssignmentDto[]> {
    const year = query.year ?? new Date().getFullYear();

    const assignments = await this.prisma.eventTypeSponsor.findMany({
      where: { eventTypeId: query.eventTypeId },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ eventTypeId: 'asc' }, { instanceIdentifier: 'asc' }],
    });

    const occurrences = await this.countOccurrences(assignments, year);

    return assignments.map((assignment) =>
      this.toAssignment(assignment, occurrences, canSeeContact),
    );
  }

  async findOne(id: number, canSeeContact: boolean): Promise<SponsorAssignmentDto> {
    const assignment = await this.prisma.eventTypeSponsor.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });

    if (!assignment) throw new NotFoundException(`Sponsor assignment ${id} was not found`);

    const occurrences = await this.countOccurrences([assignment], new Date().getFullYear());

    return this.toAssignment(assignment, occurrences, canSeeContact);
  }

  async create(dto: CreateSponsorDto, context: ActorContext): Promise<SponsorAssignmentDto> {
    await this.assertSlotExists(dto.eventTypeId, dto.instanceIdentifier);
    await this.assertSponsorIsActive(dto.userId);

    const created = await this.prisma.eventTypeSponsor.create({
      data: {
        eventTypeId: dto.eventTypeId,
        instanceIdentifier: dto.instanceIdentifier,
        customInstanceName: dto.customInstanceName,
        userId: dto.userId,
      },
      include: ASSIGNMENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'event_type_sponsor',
      entityRef: String(created.id),
      summary: `Assigned ${this.nameOf(created.user)} to ${created.eventType.nameTa} instance ${created.instanceIdentifier}`,
    });

    return this.toAssignment(created, new Map(), true);
  }

  async update(
    id: number,
    dto: UpdateSponsorDto,
    context: ActorContext,
  ): Promise<SponsorAssignmentDto> {
    const before = await this.prisma.eventTypeSponsor.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });

    if (!before) throw new NotFoundException(`Sponsor assignment ${id} was not found`);
    if (dto.userId) await this.assertSponsorIsActive(dto.userId);

    const updated = await this.prisma.eventTypeSponsor.update({
      where: { id },
      data: { userId: dto.userId, customInstanceName: dto.customInstanceName },
      include: ASSIGNMENT_INCLUDE,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'event_type_sponsor',
      entityRef: String(id),
      summary: `Updated the sponsor of ${updated.eventType.nameTa} instance ${updated.instanceIdentifier}`,
      diff: AuditService.diff(
        { userId: before.userId, customInstanceName: before.customInstanceName },
        { userId: updated.userId, customInstanceName: updated.customInstanceName },
      ),
    });

    return this.toAssignment(updated, new Map(), true);
  }

  async remove(id: number, context: ActorContext): Promise<void> {
    const assignment = await this.prisma.eventTypeSponsor.findUnique({
      where: { id },
      include: ASSIGNMENT_INCLUDE,
    });

    if (!assignment) throw new NotFoundException(`Sponsor assignment ${id} was not found`);

    await this.prisma.eventTypeSponsor.delete({ where: { id } });

    await this.audit.record(context, {
      action: 'delete',
      entity: 'event_type_sponsor',
      entityRef: String(id),
      summary: `Removed ${this.nameOf(assignment.user)} as sponsor of ${assignment.eventType.nameTa} instance ${assignment.instanceIdentifier}`,
    });
  }

  private async assertSlotExists(eventTypeId: number, instanceIdentifier: number): Promise<void> {
    const eventType = await this.prisma.eventType.findUnique({
      where: { id: eventTypeId },
      select: { noOfInstances: true, nameTa: true },
    });

    if (!eventType) throw new NotFoundException(`Event type ${eventTypeId} was not found`);

    if (instanceIdentifier > eventType.noOfInstances) {
      throw new BadRequestException(
        `${eventType.nameTa} has ${eventType.noOfInstances} instance(s); ${instanceIdentifier} is out of range`,
      );
    }
  }

  private async assertSponsorIsActive(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user) throw new NotFoundException(`User ${userId} was not found`);
    if (!user.isActive) throw new BadRequestException('That account is deactivated');
  }

  private async countOccurrences(
    assignments: { eventTypeId: number; instanceIdentifier: number }[],
    year: number,
  ): Promise<Map<string, number>> {
    if (assignments.length === 0) return new Map();

    const rows = await this.prisma.event.groupBy({
      by: ['eventTypeId', 'instanceIdentifier'],
      where: {
        eventTypeId: { in: [...new Set(assignments.map((a) => a.eventTypeId))] },
        scheduledDate: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      _count: { _all: true },
    });

    return new Map(
      rows.map((row) => [`${row.eventTypeId}:${row.instanceIdentifier}`, row._count._all]),
    );
  }

  private toAssignment(
    assignment: Prisma.EventTypeSponsorGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>,
    occurrences: Map<string, number>,
    canSeeContact: boolean,
  ): SponsorAssignmentDto {
    return {
      id: assignment.id,
      eventTypeId: assignment.eventTypeId,
      instanceIdentifier: assignment.instanceIdentifier,
      customInstanceName: assignment.customInstanceName,
      userId: assignment.userId,
      createdAt: assignment.createdAt,
      eventType: {
        id: assignment.eventType.id,
        name: assignment.eventType.nameTa,
        nameEn: assignment.eventType.nameEn ?? '',
        frequencyType: assignment.eventType.frequencyType,
        noOfInstances: assignment.eventType.noOfInstances,
        createdAt: assignment.eventType.createdAt,
        updatedAt: assignment.eventType.updatedAt,
      },
      sponsor: this.toSponsor(assignment.user, canSeeContact),
      instanceLabel: describeInstance(
        assignment.eventType.frequencyType,
        assignment.instanceIdentifier,
        assignment.customInstanceName,
      ),
      occurrences:
        occurrences.get(`${assignment.eventTypeId}:${assignment.instanceIdentifier}`) ?? 0,
    };
  }

  private toSponsor(row: SponsorRow, canSeeContact: boolean): SponsorUserDto {
    return {
      id: row.id,
      fullName: this.nameOf(row),
      email: canSeeContact ? row.email : null,
      phone: canSeeContact ? row.phone : null,
      address: row.address,
    };
  }

  private nameOf(row: Pick<SponsorRow, 'fullName' | 'nameTa'>): string {
    return row.fullName ?? row.nameTa;
  }
}
