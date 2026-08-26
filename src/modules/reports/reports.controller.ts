import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  AccountingSummaryDto,
  FinanceSummaryDto,
  IncomeStatementDto,
  QueryReportDto,
  TrialBalanceDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  @RequirePermissions('report:generate')
  @ApiOperation({ summary: 'Every account’s net position; the two sides must agree' })
  trialBalance(@Query() query: QueryReportDto): Promise<TrialBalanceDto> {
    return this.reports.trialBalance(query.financialYearId);
  }

  @Get('income-statement')
  @RequirePermissions('report:generate')
  @ApiOperation({ summary: 'Income and expenditure for the year' })
  incomeStatement(@Query() query: QueryReportDto): Promise<IncomeStatementDto> {
    return this.reports.incomeStatement(query.financialYearId);
  }

  @Get('accounting-summary')
  @RequirePermissions('transaction:view')
  @ApiOperation({ summary: 'Headline figures for the accounting dashboard' })
  accountingSummary(@Query() query: QueryReportDto): Promise<AccountingSummaryDto> {
    return this.reports.accountingSummary(query.financialYearId);
  }

  @Get('finance-summary')
  @RequirePermissions('fund:view')
  @ApiOperation({ summary: 'Fund, deposit and asset totals' })
  financeSummary(@Query() query: QueryReportDto): Promise<FinanceSummaryDto> {
    return this.reports.financeSummary(query.financialYearId);
  }
}
