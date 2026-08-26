import { Module } from '@nestjs/common';

import { FixedDepositsController } from './fixed-deposits.controller';
import { FixedDepositsService } from './fixed-deposits.service';

@Module({
  controllers: [FixedDepositsController],
  providers: [FixedDepositsService],
  exports: [FixedDepositsService],
})
export class FixedDepositsModule {}
