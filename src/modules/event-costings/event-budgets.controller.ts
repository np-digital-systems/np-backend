import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EventBudgetDto, ExpectedAmountsDto } from './dto/event-budget.dto';
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
}
