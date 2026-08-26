import { Module } from '@nestjs/common';

import { LedgerQueryModule } from '../ledger/ledger-query.module';
import { FundsController } from './funds.controller';
import { FundsService } from './funds.service';

@Module({
  imports: [LedgerQueryModule],
  controllers: [FundsController],
  providers: [FundsService],
  exports: [FundsService],
})
export class FundsModule {}
