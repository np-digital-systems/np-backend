import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext, AuthenticatedUser } from '../../common/types/authenticated-user';
import { PermissionsService } from '../auth/permissions.service';
import {
  CreateEventDto,
  EventRecordDto,
  EventsSummaryDto,
  QueryEventsDto,
  ScheduleGroupDto,
  UpdateEventDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('event:view')
  @ApiOperation({
    summary: 'The event calendar',
    description:
      'Sponsor contact details are withheld unless you hold event-sponsor:manage. Status is derived from the date, never stored.',
  })
  async findMany(
    @Query() query: QueryEventsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EventRecordDto[]> {
    return this.events.findMany(query, await this.canSeeContact(user));
  }

  @Get('summary')
  @RequirePermissions('event:view')
  summary(@Query('year') year?: string): Promise<EventsSummaryDto> {
    return this.events.summary(year ? Number(year) : undefined);
  }

  @Get('schedule')
  @RequirePermissions('event-schedule:view')
  @ApiOperation({ summary: 'Every planned slot of a year, calendared or not' })
  async schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: string,
    @Query('eventTypeId') eventTypeId?: string,
  ): Promise<ScheduleGroupDto[]> {
    return this.events.schedule(
      year ? Number(year) : new Date().getFullYear(),
      await this.canSeeContact(user),
      eventTypeId ? Number(eventTypeId) : undefined,
    );
  }

  @Get(':id')
  @RequirePermissions('event:view')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EventRecordDto> {
    return this.events.findOneOrFail(id, await this.canSeeContact(user));
  }

  @Post()
  @RequirePermissions('event:create')
  @ApiOperation({
    summary:
      'Put an occurrence on the calendar; it inherits the slot’s sponsor when it has just one',
  })
  create(@Body() dto: CreateEventDto, @Actor() context: ActorContext): Promise<EventRecordDto> {
    return this.events.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('event:update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventDto,
    @Actor() context: ActorContext,
  ): Promise<EventRecordDto> {
    return this.events.update(id, dto, context);
  }

  @Post(':id/complete')
  @RequirePermissions('event:complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<EventRecordDto> {
    return this.events.setCompleted(id, true, context);
  }

  @Post(':id/reopen')
  @RequirePermissions('event:complete')
  reopen(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<EventRecordDto> {
    return this.events.setCompleted(id, false, context);
  }

  @Delete(':id')
  @RequirePermissions('event:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @Actor() context: ActorContext): Promise<void> {
    return this.events.remove(id, context);
  }

  private async canSeeContact(user: AuthenticatedUser): Promise<boolean> {
    return (await this.permissions.forRole(user.role)).has('event-sponsor:manage');
  }
}
