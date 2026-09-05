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
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import {
  CreateEventTypeDto,
  EventSlotDto,
  UpdateEventSlotDto,
  EventTypeRecordDto,
  QueryEventTypesDto,
  UpdateEventTypeDto,
} from './dto/event-type.dto';
import { EventTypesService } from './event-types.service';

@ApiTags('event-types')
@ApiBearerAuth()
@Controller('event-types')
export class EventTypesController {
  constructor(private readonly eventTypes: EventTypesService) {}

  @Get()
  @RequirePermissions('event:view')
  @ApiOperation({ summary: 'The permanent registry of recurring temple events' })
  findMany(@Query() query: QueryEventTypesDto): Promise<EventTypeRecordDto[]> {
    return this.eventTypes.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('event:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<EventTypeRecordDto> {
    return this.eventTypes.findOneOrFail(id);
  }

  @Get(':id/slots')
  @RequirePermissions('event:view')
  @ApiOperation({ summary: "A type's slots — the fixed structure of its year" })
  slots(@Param('id', ParseIntPipe) id: number): Promise<EventSlotDto[]> {
    return this.eventTypes.slots(id);
  }

  @Patch('slots/:slotId')
  @RequirePermissions('event-type:manage')
  @ApiOperation({ summary: 'Name a slot, or retire one' })
  updateSlot(
    @Param('slotId', ParseIntPipe) slotId: number,
    @Body() dto: UpdateEventSlotDto,
    @Actor() context: ActorContext,
  ): Promise<EventSlotDto> {
    return this.eventTypes.updateSlot(slotId, dto, context);
  }

  @Post()
  @RequirePermissions('event-type:manage')
  create(
    @Body() dto: CreateEventTypeDto,
    @Actor() context: ActorContext,
  ): Promise<EventTypeRecordDto> {
    return this.eventTypes.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('event-type:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEventTypeDto,
    @Actor() context: ActorContext,
  ): Promise<EventTypeRecordDto> {
    return this.eventTypes.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('event-type:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a type that has no history behind it' })
  remove(@Param('id', ParseIntPipe) id: number, @Actor() context: ActorContext): Promise<void> {
    return this.eventTypes.remove(id, context);
  }
}
