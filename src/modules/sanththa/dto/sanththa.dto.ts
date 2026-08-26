import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export const SUBSCRIPTION_MODES = ['cash', 'bank', 'online'] as const;
export type SubscriptionMode = (typeof SUBSCRIPTION_MODES)[number];

export class SanththaMemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() memberNo!: string;
  @ApiProperty() name!: string;
  @ApiProperty() nameTa!: string;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty() address!: string;
  @ApiProperty({ nullable: true }) joinedOn!: string | null;
  @ApiProperty({ description: 'Whether they still owe the yearly subscription' })
  subscribes!: boolean;
}

export class SanththaPaymentDto {
  @ApiProperty() id!: number;
  @ApiProperty() userId!: string;
  @ApiProperty({ type: SanththaMemberDto }) member!: SanththaMemberDto;
  @ApiProperty() year!: number;
  @ApiProperty() amount!: number;
  @ApiProperty() paidOn!: string;
  @ApiProperty({
    nullable: true,
    description: 'The receipt voucher this payment was banked through',
  })
  receiptVoucherRef!: string | null;
  @ApiProperty({ enum: SUBSCRIPTION_MODES }) mode!: SubscriptionMode;
  @ApiProperty() collectedBy!: string;
  @ApiProperty() createdAt!: Date;
}

export class SanththaRegisterRowDto extends SanththaMemberDto {
  @ApiProperty({ description: 'Years this member has paid for' }) paidYears!: number[];
  @ApiProperty() totalPaid!: number;
  @ApiProperty({ description: 'Whether the year being asked about is settled' })
  paidThisYear!: boolean;
}

export class SanththaSummaryDto {
  @ApiProperty() year!: number;
  @ApiProperty() members!: number;
  @ApiProperty() subscribing!: number;
  @ApiProperty() paid!: number;
  @ApiProperty() outstanding!: number;
  @ApiProperty() collected!: number;
}

export class RecordPaymentDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

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

  @ApiPropertyOptional({ description: 'Only members who have not paid for the year' })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;
}
