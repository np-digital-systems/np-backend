import { Module } from '@nestjs/common';

import { LedgerQueryService } from './ledger-query.service';

@Module({
  providers: [LedgerQueryService],
  exports: [LedgerQueryService],
})
export class LedgerQueryModule {}
