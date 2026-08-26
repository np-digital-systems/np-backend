import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { AuditActionWire } from '../../common/enums/wire';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditEntryDto, QueryAuditDto } from './dto/audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit:view')
  @ApiOperation({
    summary: 'The audit trail',
    description:
      'Append-only at the database level: these rows cannot be edited or deleted, including by this service.',
  })
  async findMany(@Query() query: QueryAuditDto): Promise<PageDto<AuditEntryDto>> {
    const where: Prisma.AuditLogWhereInput = {
      action: AuditActionWire.toPrismaOptional(query.action),
      entity: query.entity,
      entityRef: query.entityRef,
      actorId: query.actorId,
      at:
        query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
      OR: query.search
        ? [
            { summary: { contains: query.search, mode: 'insensitive' } },
            { actorName: { contains: query.search, mode: 'insensitive' } },
            { entityRef: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { at: query.order },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => ({
        id: String(row.id),
        at: row.at,
        actorId: row.actorId,
        actorName: row.actorName,
        actorRole: row.actorRole,
        action: AuditActionWire.toWire(row.action),
        entity: row.entity,
        entityRef: row.entityRef,
        summary: row.summary,
        ipAddress: row.ipAddress,
        diff: row.diff,
      })),
      new PageMetaDto(query.page, query.limit, total),
    );
  }
}
