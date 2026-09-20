import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { VoucherRecordDto } from '../vouchers/dto/voucher.dto';
import {
  EventBudgetDto,
  ExpectedAmountsDto,
  RaisePaymentDto,
  RaiseReceiptDto,
} from './dto/event-budget.dto';
import { EventBudgetsService } from './event-budgets.service';

@ApiTags('event-budgets')
@ApiBearerAuth()
@Controller('events/:eventId')
export class EventBudgetsController {
  constructor(private readonly budgets: EventBudgetsService) {}

  @Get('budget')
  @RequirePermissions('event-costing:view')
  @ApiOperation({ summary: 'What the day was quoted at, against what the ledger says it cost' })
  find(@Param('eventId', ParseIntPipe) eventId: number): Promise<EventBudgetDto> {
    return this.budgets.find(eventId);
  }

  @Get('expected')
  @RequirePermissions('event-costing:view')
  @ApiOperation({
    summary: 'What this occurrence is expected to cost, for a voucher form to fill from',
  })
  expected(@Param('eventId', ParseIntPipe) eventId: number): Promise<ExpectedAmountsDto> {
    return this.budgets.expected(eventId);
  }

  @Post('vouchers/receipt')
  @RequirePermissions('receipt-voucher:create')
  @ApiOperation({ summary: 'A draft receipt for the sponsor, filled in from the frozen quote' })
  raiseReceipt(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: RaiseReceiptDto,
    @Actor() context: ActorContext,
  ): Promise<VoucherRecordDto> {
    return this.budgets.raiseReceipt(eventId, dto, context);
  }

  @Post('vouchers/payment')
  @RequirePermissions('payment-voucher:create')
  @ApiOperation({ summary: 'A draft payment settling budget lines, one payee at a time' })
  raisePayment(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: RaisePaymentDto,
    @Actor() context: ActorContext,
  ): Promise<VoucherRecordDto> {
    return this.budgets.raisePayment(eventId, dto, context);
  }
}
