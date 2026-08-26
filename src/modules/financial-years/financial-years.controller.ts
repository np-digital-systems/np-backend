import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import {
  CreateFinancialYearDto,
  FinancialYearDto,
  QueryFinancialYearsDto,
} from './dto/financial-year.dto';
import { FinancialYearsService } from './financial-years.service';

@ApiTags('financial-years')
@ApiBearerAuth()
@Controller('financial-years')
export class FinancialYearsController {
  constructor(private readonly years: FinancialYearsService) {}

  @Get()
  @RequirePermissions('transaction:view')
  @ApiOperation({ summary: 'List financial years; totals are live until the year is closed' })
  findMany(@Query() query: QueryFinancialYearsDto): Promise<FinancialYearDto[]> {
    return this.years.findMany(query);
  }

  @Get('current')
  @RequirePermissions('transaction:view')
  current(): Promise<FinancialYearDto> {
    return this.years.current();
  }

  @Get(':id')
  @RequirePermissions('transaction:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<FinancialYearDto> {
    return this.years.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('settings:manage')
  create(
    @Body() dto: CreateFinancialYearDto,
    @Actor() context: ActorContext,
  ): Promise<FinancialYearDto> {
    return this.years.create(dto, context);
  }

  @Post(':id/open')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Open a year and make it the current one' })
  open(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<FinancialYearDto> {
    return this.years.open(id, context);
  }

  @Post(':id/close')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Freeze the year’s totals into the row and refuse further postings' })
  close(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<FinancialYearDto> {
    return this.years.close(id, context);
  }
}
