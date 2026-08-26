import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { NotificationCategoryWire } from '../../common/enums/wire';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { NotificationPriority, UserRole } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateNotificationDto,
  NotificationCountsDto,
  NotificationDto,
  NotificationMetaDto,
  QueryNotificationsDto,
} from './dto/notification.dto';

const RECIPIENT_INCLUDE = { notification: true } satisfies Prisma.NotificationRecipientInclude;

type RecipientRow = Prisma.NotificationRecipientGetPayload<{ include: typeof RECIPIENT_INCLUDE }>;

const STAFF_ROLES: UserRole[] = [UserRole.admin, UserRole.accountant, UserRole.cashier];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMine(
    query: QueryNotificationsDto,
    context: ActorContext,
  ): Promise<PageDto<NotificationDto>> {
    const where: Prisma.NotificationRecipientWhereInput = {
      userId: context.actor.id,
      dismissedAt: null,
      readAt: query.unreadOnly ? null : undefined,
      notification: query.category
        ? { category: NotificationCategoryWire.toPrisma(query.category) }
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificationRecipient.findMany({
        where,
        include: RECIPIENT_INCLUDE,
        orderBy: { notification: { createdAt: query.order } },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.notificationRecipient.count({ where }),
    ]);

    return new PageDto(
      rows.map((row) => this.toDto(row)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async counts(context: ActorContext): Promise<NotificationCountsDto> {
    const [total, unread] = await this.prisma.$transaction([
      this.prisma.notificationRecipient.count({
        where: { userId: context.actor.id, dismissedAt: null },
      }),
      this.prisma.notificationRecipient.count({
        where: { userId: context.actor.id, dismissedAt: null, readAt: null },
      }),
    ]);

    return { total, unread };
  }

  async markRead(id: string, context: ActorContext): Promise<void> {
    const { count } = await this.prisma.notificationRecipient.updateMany({
      where: { notificationId: BigInt(id), userId: context.actor.id, readAt: null },
      data: { readAt: new Date() },
    });

    if (count === 0) await this.assertAddressed(id, context);
  }

  async markAllRead(context: ActorContext): Promise<NotificationCountsDto> {
    await this.prisma.notificationRecipient.updateMany({
      where: { userId: context.actor.id, readAt: null },
      data: { readAt: new Date() },
    });

    return this.counts(context);
  }

  async dismiss(id: string, context: ActorContext): Promise<void> {
    const recipient = await this.prisma.notificationRecipient.findUnique({
      where: { notificationId_userId: { notificationId: BigInt(id), userId: context.actor.id } },
      include: RECIPIENT_INCLUDE,
    });

    if (!recipient) throw new NotFoundException(`Notification ${id} was not sent to you`);

    if (!recipient.notification.dismissible) {
      throw new ConflictException(`Notification ${id} is not dismissible`);
    }

    await this.prisma.notificationRecipient.update({
      where: { notificationId_userId: { notificationId: BigInt(id), userId: context.actor.id } },
      data: { dismissedAt: new Date(), readAt: recipient.readAt ?? new Date() },
    });
  }

  /**
   * Raise a notification and fan it out to its audience.
   *
   * Recipients are resolved at publication rather than at read time, so
   * somebody who joins tomorrow does not inherit today's alerts.
   */
  async publish(dto: CreateNotificationDto): Promise<NotificationDto> {
    const roles = (dto.roles?.length ? dto.roles : STAFF_ROLES) as UserRole[];

    const audience = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: roles } },
      select: { id: true },
    });

    const notification = await this.prisma.$transaction(async (tx) => {
      const created = await tx.notification.create({
        data: {
          category: NotificationCategoryWire.toPrisma(dto.category),
          priority: dto.priority ?? NotificationPriority.Information,
          title: dto.title,
          message: dto.message,
          entityType: dto.entityType,
          entityRef: dto.entityRef,
          actionLabel: dto.actionLabel,
          actionHref: dto.actionPage,
          meta: dto.meta ? (dto.meta as unknown as Prisma.InputJsonValue) : undefined,
          dismissible: dto.dismissible ?? true,
        },
      });

      if (audience.length > 0) {
        await tx.notificationRecipient.createMany({
          data: audience.map((user) => ({ notificationId: created.id, userId: user.id })),
        });
      }

      return created;
    });

    this.logger.log(
      { notificationId: String(notification.id), recipients: audience.length },
      'Notification published',
    );

    return this.toDto({ notification, readAt: null, dismissedAt: null } as RecipientRow);
  }

  private async assertAddressed(id: string, context: ActorContext): Promise<void> {
    const exists = await this.prisma.notificationRecipient.count({
      where: { notificationId: BigInt(id), userId: context.actor.id },
    });

    if (exists === 0) throw new NotFoundException(`Notification ${id} was not sent to you`);
  }

  private toDto(row: RecipientRow): NotificationDto {
    const notification = row.notification;

    return {
      id: String(notification.id),
      category: NotificationCategoryWire.toWire(notification.category),
      priority: notification.priority,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType,
      entityRef: notification.entityRef,
      actionLabel: notification.actionLabel,
      actionPage: notification.actionHref,
      meta: (notification.meta as NotificationMetaDto[] | null) ?? null,
      timestamp: notification.createdAt,
      read: row.readAt !== null,
      dismissible: notification.dismissible,
    };
  }
}
