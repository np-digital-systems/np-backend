import { Module } from '@nestjs/common';

import { LedgerQueryModule } from '../ledger/ledger-query.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { FixedDepositsController } from './fixed-deposits.controller';
import { FixedDepositsService } from './fixed-deposits.service';

@Module({
  imports: [LedgerQueryModule, VouchersModule],
  controllers: [FixedDepositsController],
  providers: [FixedDepositsService],
  exports: [FixedDepositsService],
})
export class FixedDepositsModule {}
