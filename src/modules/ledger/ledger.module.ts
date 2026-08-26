import { Module } from '@nestjs/common';

import { BankAccountsModule } from '../bank-accounts/bank-accounts.module';
import { LedgerController } from './ledger.controller';
import { LedgerQueryModule } from './ledger-query.module';
import { LedgerService } from './ledger.service';

@Module({
  imports: [LedgerQueryModule, BankAccountsModule],
  controllers: [LedgerController],
  providers: [LedgerService],
})
export class LedgerModule {}
