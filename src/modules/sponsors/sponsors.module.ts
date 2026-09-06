import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { EventSponsorsController } from './event-sponsors.controller';
import { EventSponsorsService } from './event-sponsors.service';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';

@Module({
  imports: [AuthModule],
  controllers: [SponsorsController, EventSponsorsController],
  providers: [SponsorsService, EventSponsorsService],
  exports: [SponsorsService],
})
export class SponsorsModule {}
