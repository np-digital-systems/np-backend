import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { SanththaController } from './sanththa.controller';
import { SanththaService } from './sanththa.service';

@Module({
  // The subscription receipt is raised through VouchersService, so reference
  // allocation, coding validation and posting stay defined in one place.
  imports: [AuthModule, VouchersModule],
  controllers: [SanththaController],
  providers: [SanththaService],
  exports: [SanththaService],
})
export class SanththaModule {}
