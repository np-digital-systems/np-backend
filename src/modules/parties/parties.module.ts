import { Module } from '@nestjs/common';

import { LedgerQueryModule } from '../ledger/ledger-query.module';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';

@Module({
  imports: [LedgerQueryModule],
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
