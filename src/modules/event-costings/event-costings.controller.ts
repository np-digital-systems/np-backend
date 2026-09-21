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
  CopyCostingDto,
  CostingRecordDto,
  CostingSummaryDto,
  CreateCostingDto,
  QueryCostingsDto,
  ResolveCostingDto,
  UpdateCostingDto,
} from './dto/event-costing.dto';
import { EventCostingsService } from './event-costings.service';

@ApiTags('event-costings')
@ApiBearerAuth()
@Controller('event-costings')
export class EventCostingsController {
  constructor(private readonly costings: EventCostingsService) {}

  @Get()
  @RequirePermissions('event-costing:view')
  @ApiOperation({ summary: 'What each pooja is expected to cost, version by version' })
  findMany(@Query() query: QueryCostingsDto): Promise<CostingRecordDto[]> {
    return this.costings.findMany(query);
  }

  @Get('resolve')
  @RequirePermissions('event-costing:view')
  @ApiOperation({ summary: 'What an instance would be quoted on a date, without costing anything' })
  resolve(@Query() query: ResolveCostingDto): Promise<CostingSummaryDto> {
    return this.costings.resolve(query.slotId, new Date(`${query.on}T00:00:00.000Z`));
  }

  @Get(':id')
  @RequirePermissions('event-costing:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<CostingRecordDto> {
    return this.costings.findOneOrFail(id);
  }

  @Get(':id/history')
  @RequirePermissions('event-costing:view')
  @ApiOperation({ summary: 'Every version this pooja and instance has had, newest first' })
  history(@Param('id', ParseIntPipe) id: number): Promise<CostingRecordDto[]> {
    return this.costings.history(id);
  }

  @Post()
  @RequirePermissions('event-costing:manage')
  @ApiOperation({ summary: 'Save a costing as a draft. It prices nothing until it is applied' })
  create(@Body() dto: CreateCostingDto, @Actor() context: ActorContext): Promise<CostingRecordDto> {
    return this.costings.create(dto, context);
  }

  /*
   * The same permission as saving one. Splitting applying from managing would
   * be defensible — writing next year's figures and deciding today is the day
   * they start being quoted are different acts — but nobody has asked for that,
   * and a permission no seeded role holds is an Apply button nobody can press.
   */
  @Post(':id/apply')
  @RequirePermissions('event-costing:manage')
  @ApiOperation({ summary: 'Put a draft into force, closing the version it replaces' })
  apply(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<CostingRecordDto> {
    return this.costings.apply(id, context);
  }

  @Post(':id/copy')
  @RequirePermissions('event-costing:manage')
  @ApiOperation({ summary: 'Day two of a festival is day one with three figures changed' })
  copy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CopyCostingDto,
    @Actor() context: ActorContext,
  ): Promise<CostingRecordDto> {
    return this.costings.copy(id, dto, context);
  }

  @Patch(':id')
  @RequirePermissions('event-costing:manage')
  @ApiOperation({
    summary: 'Save a costing. Editing the version in force writes to that scope’s draft instead',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCostingDto,
    @Actor() context: ActorContext,
  ): Promise<CostingRecordDto> {
    return this.costings.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('event-costing:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a version nothing was costed from and nothing replaced' })
  remove(@Param('id', ParseIntPipe) id: number, @Actor() context: ActorContext): Promise<void> {
    return this.costings.remove(id, context);
  }
}
