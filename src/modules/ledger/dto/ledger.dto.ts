import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { VoucherStatusWire } from '../../../common/enums/wire';
import type { WireVoucherStatus } from '../../../common/enums/wire';
import { PaymentMode } from '../../../generated/prisma/enums';
import { AccountRefDto } from '../../accounts/dto/account.dto';
import { FundRefDto } from '../../funds/dto/fund.dto';
import { ProjectRefDto } from '../../projects/dto/project.dto';

export class LedgerRecordDto {
  @ApiProperty() id!: number;
  @ApiProperty() voucherId!: number;
  @ApiProperty() date!: string;
  @ApiProperty() ref!: string;
  @ApiProperty() description!: string;
  @ApiProperty() accountId!: number;
  @ApiProperty() fundId!: number;
  @ApiProperty({ nullable: true }) projectId!: number | null;
  @ApiProperty({ nullable: true }) debit!: number | null;
  @ApiProperty({ nullable: true }) credit!: number | null;
  @ApiProperty({ enum: PaymentMode }) mode!: PaymentMode;
  @ApiProperty({ nullable: true }) bankAccountId!: number | null;
  @ApiProperty({ enum: VoucherStatusWire.values }) status!: WireVoucherStatus;
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty({ type: FundRefDto }) fund!: FundRefDto;
  @ApiProperty({ type: ProjectRefDto, nullable: true }) project!: ProjectRefDto | null;
}

export class BookRowDto extends LedgerRecordDto {
  @ApiProperty({ description: 'Money in — receipts, or deposits' }) inflow!: number;
  @ApiProperty({ description: 'Money out — payments, or withdrawals' }) outflow!: number;
  @ApiProperty({ description: 'Running balance after this row' }) balance!: number;
  @ApiProperty({ nullable: true }) chequeNo!: string | null;
}

export class BookSummaryDto {
  @ApiProperty() opening!: number;
  @ApiProperty() inflow!: number;
  @ApiProperty() outflow!: number;
  @ApiProperty() closing!: number;
}

export class BookDto {
  @ApiProperty({ type: BookRowDto, isArray: true }) rows!: BookRowDto[];
  @ApiProperty({ type: BookSummaryDto }) summary!: BookSummaryDto;
}

export class QueryLedgerDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accountId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fundId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class QueryBookDto {
  @ApiPropertyOptional({ description: 'Required for the bank book' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
