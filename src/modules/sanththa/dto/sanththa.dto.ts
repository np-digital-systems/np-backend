import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export const SUBSCRIPTION_MODES = ['cash', 'bank', 'online'] as const;
export type SubscriptionMode = (typeof SUBSCRIPTION_MODES)[number];

export class SanththaSponsorDto {
  @ApiProperty({ description: 'The party id — a sponsor is a party' }) partyId!: number;
  @ApiProperty() sponsorNo!: string;
  @ApiProperty() name!: string;
  @ApiProperty() nameTa!: string;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty({ nullable: true }) sponsorSince!: string | null;
  @ApiProperty({ description: 'Whether the yearly subscription is due from them' })
  subscribes!: boolean;
}

export class SanththaPaymentDto {
  @ApiProperty() id!: number;
  @ApiProperty() sponsorId!: number;
  @ApiProperty({ type: SanththaSponsorDto }) sponsor!: SanththaSponsorDto;
  @ApiProperty() year!: number;
  @ApiProperty() amount!: number;
  @ApiProperty() paidOn!: string;
  @ApiProperty({ nullable: true, description: 'The receipt voucher this was banked through' })
  receiptVoucherRef!: string | null;
  @ApiProperty({ enum: SUBSCRIPTION_MODES }) mode!: SubscriptionMode;
  @ApiProperty() collectedBy!: string;
  @ApiProperty() createdAt!: Date;
}

export class SanththaRegisterRowDto extends SanththaSponsorDto {
  @ApiProperty({ description: 'Years this sponsor has paid for' }) paidYears!: number[];
  @ApiProperty() totalPaid!: number;
  @ApiProperty({ description: 'Whether the year being asked about is settled' })
  paidThisYear!: boolean;
}

export class SanththaSummaryDto {
  @ApiProperty() year!: number;
  @ApiProperty({ nullable: true, description: 'The fixed amount set for this year' })
  rate!: number | null;
  @ApiProperty() sponsors!: number;
  @ApiProperty() subscribing!: number;
  @ApiProperty() paid!: number;
  @ApiProperty() outstanding!: number;
  @ApiProperty() collected!: number;
  @ApiProperty({ description: 'What the year should bring in at the set rate' })
  expected!: number;
}

export class SanththaRateDto {
  @ApiProperty() year!: number;
  @ApiProperty() amount!: number;
  @ApiProperty({ nullable: true }) setBy!: string | null;
  @ApiProperty() setAt!: Date;
}

/** The rate is fixed for everyone and set once a year. */
export class SetRateDto {
  @ApiProperty({ minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 1000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}

export class RecordPaymentDto {
  @ApiProperty({ description: 'The sponsor paying — their party id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sponsorId!: number;

  @ApiProperty({ minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional({ description: 'Defaults to the rate set for the year' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  paidOn!: string;

  @ApiProperty({ enum: SUBSCRIPTION_MODES, description: 'A subscription is never taken by cheque' })
  @IsIn(SUBSCRIPTION_MODES)
  mode!: SubscriptionMode;

  @ApiPropertyOptional({ description: 'Link the receipt voucher this was banked through' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  receiptVoucherId?: number;
}

export class QueryRegisterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to this year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ description: 'Only sponsors who have not paid for the year' })
  @IsOptional()
  @Type(() => Boolean)
  outstandingOnly?: boolean;
}

export class QueryPaymentsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ description: 'The sponsor’s party id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sponsorId?: number;
}
