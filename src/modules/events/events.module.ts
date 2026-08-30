import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PublicEventsController } from './public-events.controller';

@Module({
  imports: [AuthModule],
  controllers: [EventsController, PublicEventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
