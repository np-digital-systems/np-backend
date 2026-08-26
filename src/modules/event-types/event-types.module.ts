import { Module } from '@nestjs/common';

import { EventTypesController } from './event-types.controller';
import { EventTypesService } from './event-types.service';

@Module({
  controllers: [EventTypesController],
  providers: [EventTypesService],
  exports: [EventTypesService],
})
export class EventTypesModule {}
