import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';

import { FinancialYearStatus } from '../../../generated/prisma/enums';

export class FinancialYearDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: '2026/27' }) label!: string;
  @ApiProperty() startsOn!: string;
  @ApiProperty() endsOn!: string;
  @ApiProperty({ enum: FinancialYearStatus }) status!: FinancialYearStatus;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty({
    description:
      'Opening cash and bank, summed from the chart of accounts. Frozen on close; live figure while open',
  })
  openingBalance!: number;
  @ApiProperty({ nullable: true, description: 'Frozen on close; live figure while open' })
  income!: number | null;
  @ApiProperty({ nullable: true }) expenses!: number | null;
  @ApiProperty({ nullable: true }) surplus!: number | null;
  @ApiProperty({ nullable: true }) voucherCount!: number | null;
  @ApiProperty({ nullable: true }) closedOn!: Date | null;
}

export class CreateFinancialYearDto {
  @ApiProperty({ example: '2026/27' })
  @IsString()
  @Matches(/^\d{4}(\/\d{2,4})?$/, { message: 'label should look like "2026" or "2026/27"' })
  label!: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  startsOn!: string;

  @ApiProperty({ example: '2027-03-31' })
  @IsDateString()
  endsOn!: string;

  /*
   * No openingBalance here on purpose. It is summed from the opening balances
   * on the cash and bank heads, so there is nothing for the caller to supply.
   */
}

export class QueryFinancialYearsDto {
  @ApiPropertyOptional({ enum: FinancialYearStatus })
  @IsOptional()
  @IsString()
  status?: FinancialYearStatus;
}
