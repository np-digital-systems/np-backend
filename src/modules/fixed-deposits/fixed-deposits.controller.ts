import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { DepositStatus } from '../../generated/prisma/enums';
import {
  CreateFixedDepositDto,
  DepositRecordDto,
  QueryDepositsDto,
  RenewDepositDto,
  UpdateFixedDepositDto,
} from './dto/fixed-deposit.dto';
import { FixedDepositsService } from './fixed-deposits.service';

@ApiTags('fixed-deposits')
@ApiBearerAuth()
@Controller('fixed-deposits')
export class FixedDepositsController {
  constructor(private readonly deposits: FixedDepositsService) {}

  @Get()
  @RequirePermissions('fixed-deposit:view')
  @ApiOperation({ summary: 'Deposits with interest and maturity worked out' })
  findMany(@Query() query: QueryDepositsDto): Promise<DepositRecordDto[]> {
    return this.deposits.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('fixed-deposit:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<DepositRecordDto> {
    return this.deposits.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('fixed-deposit:manage')
  create(
    @Body() dto: CreateFixedDepositDto,
    @Actor() context: ActorContext,
  ): Promise<DepositRecordDto> {
    return this.deposits.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('fixed-deposit:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFixedDepositDto,
    @Actor() context: ActorContext,
  ): Promise<DepositRecordDto> {
    return this.deposits.update(id, dto, context);
  }

  @Post(':id/mature')
  @RequirePermissions('fixed-deposit:manage')
  mature(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<DepositRecordDto> {
    return this.deposits.changeStatus(id, DepositStatus.matured, context);
  }

  @Post(':id/close')
  @RequirePermissions('fixed-deposit:manage')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<DepositRecordDto> {
    return this.deposits.changeStatus(id, DepositStatus.closed, context);
  }

  @Post(':id/renew')
  @RequirePermissions('fixed-deposit:manage')
  @ApiOperation({ summary: 'Roll into a new certificate; the old one is marked renewed' })
  renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewDepositDto,
    @Actor() context: ActorContext,
  ): Promise<DepositRecordDto> {
    return this.deposits.renew(id, dto, context);
  }
}
