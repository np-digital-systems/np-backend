import { Module } from '@nestjs/common';

import { FundsModule } from '../funds/funds.module';
import { LedgerQueryModule } from '../ledger/ledger-query.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [LedgerQueryModule, FundsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
