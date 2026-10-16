import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { SanththaController } from './sanththa.controller';
import { SanththaService } from './sanththa.service';

@Module({
  // Receipts go through VouchersService so numbering, coding checks and posting stay in one place.
  imports: [AuthModule, VouchersModule],
  controllers: [SanththaController],
  providers: [SanththaService],
  exports: [SanththaService],
})
export class SanththaModule {}
