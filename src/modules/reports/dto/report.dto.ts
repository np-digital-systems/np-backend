import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

import { AccountRefDto } from '../../accounts/dto/account.dto';

export class StatementLineDto {
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty() amount!: number;
  @ApiProperty({ description: 'Share of its side of the statement' }) share!: number;
}

export class IncomeStatementDto {
  @ApiProperty({ type: StatementLineDto, isArray: true }) income!: StatementLineDto[];
  @ApiProperty({ type: StatementLineDto, isArray: true }) expenses!: StatementLineDto[];
  @ApiProperty() totalIncome!: number;
  @ApiProperty() totalExpenses!: number;
  @ApiProperty() surplus!: number;
}

export class TrialBalanceRowDto {
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty() debit!: number;
  @ApiProperty() credit!: number;
}

export class TrialBalanceDto {
  @ApiProperty({ type: TrialBalanceRowDto, isArray: true }) rows!: TrialBalanceRowDto[];
  @ApiProperty() totalDebit!: number;
  @ApiProperty() totalCredit!: number;
  @ApiProperty({ description: 'True when both sides agree, as they must' }) balanced!: boolean;
}

export class BalanceLineDto {
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty() amount!: number;
}

export class BalanceSheetDto {
  @ApiProperty({ description: 'The last day of the financial year' }) asOf!: string;
  @ApiProperty() financialYearLabel!: string;
  @ApiProperty({ type: BalanceLineDto, isArray: true }) assets!: BalanceLineDto[];
  @ApiProperty({ type: BalanceLineDto, isArray: true }) liabilities!: BalanceLineDto[];
  @ApiProperty({ type: BalanceLineDto, isArray: true }) equity!: BalanceLineDto[];
  @ApiProperty({ description: 'Income less expenditure, every year to date' })
  accumulatedSurplus!: number;
  @ApiProperty() totalAssets!: number;
  @ApiProperty({ description: 'Liabilities, equity and the accumulated surplus' })
  totalLiabilitiesAndEquity!: number;
  @ApiProperty({
    description: 'Opening balances that were entered on one side only; nil when they agree',
  })
  openingDifference!: number;
  @ApiProperty({ description: 'True when the two sides agree, as they must' }) balanced!: boolean;
}

export class AccountingSummaryDto {
  @ApiProperty() income!: number;
  @ApiProperty() expenses!: number;
  @ApiProperty() surplus!: number;
  @ApiProperty() cashBalance!: number;
  @ApiProperty() bankBalance!: number;
  @ApiProperty() pendingApprovals!: number;
  @ApiProperty() pendingAmount!: number;
}

export class FinanceSummaryDto {
  @ApiProperty() fundBalance!: number;
  @ApiProperty() depositPrincipal!: number;
  @ApiProperty() depositMaturityValue!: number;
  @ApiProperty() assetCost!: number;
  @ApiProperty() assetNetBookValue!: number;
}

export class QueryReportDto {
  @ApiPropertyOptional({ description: 'Defaults to the current financial year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;
}
