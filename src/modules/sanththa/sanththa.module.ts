import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SanththaController } from './sanththa.controller';
import { SanththaService } from './sanththa.service';

@Module({
  imports: [AuthModule],
  controllers: [SanththaController],
  providers: [SanththaService],
  exports: [SanththaService],
})
export class SanththaModule {}
