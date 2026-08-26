import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DepositStatus, InterestPayout } from '../../../generated/prisma/enums';

export class DepositRecordDto {
  @ApiProperty() id!: number;
  @ApiProperty() certificateNo!: string;
  @ApiProperty() bankName!: string;
  @ApiProperty() branch!: string;
  @ApiProperty() principal!: number;
  @ApiProperty({ example: 12.5, description: 'Annual rate as a percentage' }) interestRate!: number;
  @ApiProperty() placedOn!: string;
  @ApiProperty() maturesOn!: string;
  @ApiProperty() tenureMonths!: number;
  @ApiProperty({ enum: InterestPayout }) interestPayout!: InterestPayout;
  @ApiProperty() fundId!: number;
  @ApiProperty() fundName!: string;
  @ApiProperty({ enum: DepositStatus }) status!: DepositStatus;
  @ApiProperty({ nullable: true }) renewedFromId!: number | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ description: 'Simple interest over the full term' }) interestOnMaturity!: number;
  @ApiProperty() maturityValue!: number;
  @ApiProperty({ description: 'Accrued from placement to today' }) interestAccrued!: number;
  @ApiProperty({ description: 'Negative once past maturity' }) daysToMaturity!: number;
  @ApiProperty() isMaturingSoon!: boolean;
  @ApiProperty() isOverdue!: boolean;
}

export class CreateFixedDepositDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  certificateNo!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  bankName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  branch!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  principal!: number;

  @ApiProperty({ example: 12.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99.99)
  interestRate!: number;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  placedOn!: string;

  @ApiProperty({ example: '2027-04-01' })
  @IsDateString()
  maturesOn!: string;

  @ApiProperty({ minimum: 1, maximum: 600 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  tenureMonths!: number;

  @ApiProperty({ enum: InterestPayout })
  @IsEnum(InterestPayout)
  interestPayout!: InterestPayout;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fundId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateFixedDepositDto extends PartialType(
  OmitType(CreateFixedDepositDto, ['certificateNo'] as const),
) {}

export class RenewDepositDto extends OmitType(CreateFixedDepositDto, ['fundId'] as const) {}

export class QueryDepositsDto {
  @ApiPropertyOptional({ enum: DepositStatus })
  @IsOptional()
  @IsEnum(DepositStatus)
  status?: DepositStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fundId?: number;

  @ApiPropertyOptional({ description: 'Only deposits inside the maturity alert window' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  maturingSoon?: boolean;
}
