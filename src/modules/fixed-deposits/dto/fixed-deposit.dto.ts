import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { InterestPayoutWire } from '../../../common/enums/wire';
import type { WireInterestPayout } from '../../../common/enums/wire';
import { DepositStatus, PaymentMode } from '../../../generated/prisma/enums';

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
  @ApiProperty({ enum: InterestPayoutWire.values }) interestPayout!: WireInterestPayout;
  @ApiProperty() fundId!: number;
  @ApiProperty() fundName!: string;
  @ApiProperty({ nullable: true, description: 'Null for a kovil deposit' }) slotId!: number | null;
  @ApiProperty({ nullable: true }) poojaName!: string | null;
  @ApiProperty({ nullable: true }) bankAccountId!: number | null;
  @ApiProperty({ enum: DepositStatus }) status!: DepositStatus;
  @ApiProperty({ nullable: true }) renewedFromId!: number | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ description: 'Simple interest over the full term' }) interestOnMaturity!: number;
  @ApiProperty() maturityValue!: number;
  @ApiProperty({ description: 'Accrued from placement to today' }) interestAccrued!: number;
  @ApiProperty({ description: 'Negative once past maturity' }) daysToMaturity!: number;
  @ApiProperty() isMaturingSoon!: boolean;
  @ApiProperty() isOverdue!: boolean;
  @ApiProperty({ description: 'Posted interest receipts, all years' }) interestReceived!: number;
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

  @ApiProperty({ enum: InterestPayoutWire.values })
  @IsIn(InterestPayoutWire.values)
  interestPayout!: WireInterestPayout;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fundId!: number;

  @ApiPropertyOptional({ description: 'The pooja slot the interest pays for; omit for the kovil' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slotId?: number | null;

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

// Fund and pooja carry over from the certificate being renewed.
export class RenewDepositDto extends OmitType(CreateFixedDepositDto, [
  'fundId',
  'slotId',
] as const) {}

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

export class RecordInterestDto {
  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '2026-10-29' })
  @IsDateString()
  receivedOn!: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  mode!: PaymentMode;

  @ApiPropertyOptional({ description: "Defaults to the deposit's bank account" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  chequeNo?: string;

  @ApiProperty({ description: 'The number on the paper voucher book' })
  @IsString()
  @IsNotEmpty({ message: 'The manual voucher number is required' })
  @MaxLength(60)
  manualVoucherNo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

class DepositInterestYearDto {
  @ApiProperty() financialYearId!: number;
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

export class DepositInterestDto {
  @ApiProperty() depositId!: number;
  @ApiProperty({ type: [String], description: 'This certificate and those it renewed or became' })
  certificates!: string[];
  @ApiProperty({ type: [DepositInterestYearDto] }) years!: DepositInterestYearDto[];
  @ApiProperty() total!: number;
}

export class SlotOptionDto {
  @ApiProperty() id!: number;
  @ApiProperty() poojaName!: string;
}

class PoojaFundingRowDto {
  @ApiProperty({ nullable: true, description: 'Null for the kovil deposits' })
  slotId!: number | null;
  @ApiProperty({ nullable: true }) poojaName!: string | null;
  @ApiProperty({ nullable: true }) sponsorName!: string | null;
  @ApiProperty() deposits!: number;
  @ApiProperty({ description: 'Principal of the active deposits' }) principal!: number;
  @ApiProperty() interestReceived!: number;
  @ApiProperty({ description: 'Other receipts for the occurrences' }) sponsorTopUps!: number;
  @ApiProperty() spent!: number;
  @ApiProperty({ description: 'Positive is surplus, negative a shortfall' }) balance!: number;
}

export class PoojaFundingDto {
  @ApiProperty() financialYearId!: number;
  @ApiProperty() financialYearLabel!: string;
  @ApiProperty({ type: [PoojaFundingRowDto] }) rows!: PoojaFundingRowDto[];
}

export class QueryPoojaFundingDto {
  @ApiPropertyOptional({ description: 'Defaults to the current year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;
}
