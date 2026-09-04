import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ActivitiesService } from './activities.service';
import {
  ActivityRecordDto,
  CreateActivityDto,
  QueryActivitiesDto,
  UpdateActivityDto,
} from './dto/activity.dto';

/*
 * Activities are chart-of-accounts-adjacent master data, so they are governed
 * by the same capability as the chart itself rather than a new one — which
 * also means no role needs re-seeding before this can be used.
 */
@ApiTags('activities')
@ApiBearerAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('account:view')
  @ApiOperation({ summary: 'What entries are coded to — poojas, services and general upkeep' })
  findMany(@Query() query: QueryActivitiesDto): Promise<ActivityRecordDto[]> {
    return this.activities.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('account:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<ActivityRecordDto> {
    return this.activities.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('account:manage')
  @ApiOperation({ summary: 'Add an activity — a new pooja needs no schema change' })
  create(
    @Body() dto: CreateActivityDto,
    @Actor() context: ActorContext,
  ): Promise<ActivityRecordDto> {
    return this.activities.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('account:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateActivityDto,
    @Actor() context: ActorContext,
  ): Promise<ActivityRecordDto> {
    return this.activities.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('account:manage')
  @ApiOperation({ summary: 'Retire an activity; posted entries keep naming it' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<ActivityRecordDto> {
    return this.activities.deactivate(id, context);
  }
}
