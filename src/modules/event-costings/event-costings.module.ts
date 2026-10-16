import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EventBudgetsController } from './event-budgets.controller';
import { EventBudgetsService } from './event-budgets.service';
import { EventCostingsController } from './event-costings.controller';
import { EventCostingsService } from './event-costings.service';

@Module({
  imports: [AuthModule],
  controllers: [EventCostingsController, EventBudgetsController],
  providers: [EventCostingsService, EventBudgetsService],
})
export class EventCostingsModule {}
