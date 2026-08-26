import { Injectable, Logger } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { AuditAction, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityRef?: string | null;
  summary: string;
  diff?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(context: ActorContext, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: context.actor.id,
          actorName: context.actor.name,
          actorRole: context.actor.role,
          ipAddress: context.ipAddress,
          action: entry.action,
          entity: entry.entity,
          entityRef: entry.entityRef ?? null,
          summary: entry.summary,
          diff: entry.diff,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, entity: entry.entity, action: entry.action },
        'Failed to write an audit entry',
      );
    }
  }

  static diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    const changed: Record<string, { from: unknown; to: unknown }> = {};

    for (const key of Object.keys(after)) {
      if (after[key] === undefined) continue;
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;

      changed[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }

    return Object.keys(changed).length > 0 ? (changed as Prisma.InputJsonValue) : undefined;
  }
}
