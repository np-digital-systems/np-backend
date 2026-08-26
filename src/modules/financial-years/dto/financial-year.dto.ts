import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

import { FinancialYearStatus } from '../../../generated/prisma/enums';

export class FinancialYearDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: '2026/27' }) label!: string;
  @ApiProperty() startsOn!: string;
  @ApiProperty() endsOn!: string;
  @ApiProperty({ enum: FinancialYearStatus }) status!: FinancialYearStatus;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty() openingBalance!: number;
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

  @ApiPropertyOptional({ description: 'Carried in from the previous year' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingBalance?: number;
}

export class QueryFinancialYearsDto {
  @ApiPropertyOptional({ enum: FinancialYearStatus })
  @IsOptional()
  @IsString()
  status?: FinancialYearStatus;
}
