import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { DepositStatus } from '../../generated/prisma/enums';
import { VoucherRecordDto } from '../vouchers/dto/voucher.dto';
import {
  CloseDepositDto,
  CreateFixedDepositDto,
  DepositInterestDto,
  DepositRecordDto,
  PoojaFundingDto,
  QueryDepositsDto,
  QueryPoojaFundingDto,
  RecordInterestDto,
  RenewDepositDto,
  SlotOptionDto,
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

  @Get('pooja-funding')
  @RequirePermissions('fixed-deposit:view')
  @ApiOperation({
    summary: 'Per pooja: deposit interest and top-ups against what it cost, for a year',
  })
  fundingByPooja(@Query() query: QueryPoojaFundingDto): Promise<PoojaFundingDto> {
    return this.deposits.fundingByPooja(query);
  }

  @Get('slot-options')
  @RequirePermissions('fixed-deposit:view')
  @ApiOperation({ summary: 'Pooja slots a deposit can pay for' })
  slotOptions(): Promise<SlotOptionDto[]> {
    return this.deposits.slotOptions();
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

  @Get(':id/interest')
  @RequirePermissions('fixed-deposit:view')
  @ApiOperation({ summary: 'Posted interest by financial year, across the renewal chain' })
  interestByYear(@Param('id', ParseIntPipe) id: number): Promise<DepositInterestDto> {
    return this.deposits.interestByYear(id);
  }

  @Post(':id/interest')
  @RequirePermissions('fixed-deposit:manage')
  @ApiOperation({ summary: 'Raise the interest receipt for approval' })
  recordInterest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecordInterestDto,
    @Actor() context: ActorContext,
  ): Promise<VoucherRecordDto> {
    return this.deposits.recordInterest(id, dto, context);
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
  @ApiOperation({ summary: 'Close and raise the receipt that takes the principal off the books' })
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseDepositDto,
    @Actor() context: ActorContext,
  ): Promise<DepositRecordDto> {
    return this.deposits.close(id, dto, context);
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
