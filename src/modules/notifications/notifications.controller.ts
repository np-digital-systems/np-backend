import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import type { ActorContext } from '../../common/types/authenticated-user';
import {
  CreateNotificationDto,
  NotificationCountsDto,
  NotificationDto,
  QueryNotificationsDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Your notifications. Every signed-in user has these; no permission gates them.',
  })
  findMine(
    @Query() query: QueryNotificationsDto,
    @Actor() context: ActorContext,
  ): Promise<PageDto<NotificationDto>> {
    return this.notifications.findMine(query, context);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Badge counts for the header' })
  counts(@Actor() context: ActorContext): Promise<NotificationCountsDto> {
    return this.notifications.counts(context);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@Param('id') id: string, @Actor() context: ActorContext): Promise<void> {
    return this.notifications.markRead(id, context);
  }

  @Post('read-all')
  markAllRead(@Actor() context: ActorContext): Promise<NotificationCountsDto> {
    return this.notifications.markAllRead(context);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dismiss a notification that allows it' })
  dismiss(@Param('id') id: string, @Actor() context: ActorContext): Promise<void> {
    return this.notifications.dismiss(id, context);
  }

  @Post()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Raise a notification and fan it out to a set of roles' })
  publish(@Body() dto: CreateNotificationDto): Promise<NotificationDto> {
    return this.notifications.publish(dto);
  }
}
