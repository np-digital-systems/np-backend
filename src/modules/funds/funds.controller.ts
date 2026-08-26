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
import {
  CreateFundDto,
  FundBreakdownLineDto,
  FundRecordDto,
  QueryFundsDto,
  UpdateFundDto,
} from './dto/fund.dto';
import { FundsService } from './funds.service';

@ApiTags('funds')
@ApiBearerAuth()
@Controller('funds')
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  @Get()
  @RequirePermissions('fund:view')
  @ApiOperation({ summary: 'Funds with their position derived from the ledger' })
  findMany(@Query() query: QueryFundsDto): Promise<FundRecordDto[]> {
    return this.funds.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('fund:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<FundRecordDto> {
    return this.funds.findOneOrFail(id);
  }

  @Get(':id/breakdown')
  @RequirePermissions('fund:view')
  @ApiOperation({ summary: 'Income and expenditure heads as they bear on this fund' })
  breakdown(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ income: FundBreakdownLineDto[]; expenses: FundBreakdownLineDto[] }> {
    return this.funds.breakdown(id);
  }

  @Post()
  @RequirePermissions('fund:manage')
  create(@Body() dto: CreateFundDto, @Actor() context: ActorContext): Promise<FundRecordDto> {
    return this.funds.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('fund:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFundDto,
    @Actor() context: ActorContext,
  ): Promise<FundRecordDto> {
    return this.funds.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('fund:manage')
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<FundRecordDto> {
    return this.funds.deactivate(id, context);
  }
}
