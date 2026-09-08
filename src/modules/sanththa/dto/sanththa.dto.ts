import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
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
  @ApiProperty({
    nullable: true,
    description: 'Where that receipt has got to. Null when no receipt is linked.',
  })
  receiptStatus!: string | null;
  @ApiProperty({ nullable: true, description: 'The number written on the paper receipt book' })
  manualVoucherNo!: string | null;
  @ApiProperty({
    description:
      'Whether this may still be corrected. False once the receipt is approved or posted — from there a mistake is fixed by a further entry, not a rewrite.',
  })
  editable!: boolean;
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

/**
 * Where a subscription will land, so the counter can say so before taking money.
 *
 * Answered from the configuration rather than from constants in the browser: a
 * screen that names a head it does not actually post to is worse than one that
 * names none, and this is the same lookup the write itself does.
 */
export class SanththaPostingDto {
  @ApiProperty({ description: 'Whether a subscription can be receipted at all yet' })
  configured!: boolean;
  @ApiProperty({ nullable: true }) accountCode!: string | null;
  @ApiProperty({ nullable: true }) accountName!: string | null;
  @ApiProperty({ nullable: true }) fundName!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'The activity the head is coded to, where it has one',
  })
  activityName!: string | null;
  @ApiProperty({
    nullable: true,
    description: 'What is missing, when the coding is not usable yet',
  })
  problem!: string | null;
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

  @ApiProperty({
    description:
      'The number written on the paper receipt book. Required: the member walks away holding it, so an entry without one cannot be tied back to what they hold.',
  })
  @IsString()
  @IsNotEmpty({ message: 'The receipt book number is required' })
  @MaxLength(32)
  manualVoucherNo!: string;

  @ApiPropertyOptional({ description: 'Link the receipt voucher this was banked through' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  receiptVoucherId?: number;
}

/**
 * Correcting a subscription already taken.
 *
 * Only what a clerk can get wrong at the counter: how much, when, how, and the
 * number off the paper book. The member and the year are what identify the row
 * — changing those is not a correction but a different subscription.
 */
export class UpdatePaymentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsDateString()
  paidOn?: string;

  @ApiPropertyOptional({ enum: SUBSCRIPTION_MODES })
  @IsOptional()
  @IsIn(SUBSCRIPTION_MODES)
  mode?: SubscriptionMode;

  @ApiPropertyOptional({ description: 'Omit to leave it as it is; it cannot be cleared' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'The receipt book number is required' })
  @MaxLength(32)
  manualVoucherNo?: string;
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
