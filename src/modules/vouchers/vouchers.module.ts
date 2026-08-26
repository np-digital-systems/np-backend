import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthModule } from '../auth/auth.module';
import { BankAccountsModule } from '../bank-accounts/bank-accounts.module';
import { FinancialYearsModule } from '../financial-years/financial-years.module';
import { ProjectsModule } from '../projects/projects.module';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';

@Module({
  imports: [AuthModule, FinancialYearsModule, AccountsModule, ProjectsModule, BankAccountsModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
