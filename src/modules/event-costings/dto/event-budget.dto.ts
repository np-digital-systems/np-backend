import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PaymentMode } from '../../../generated/prisma/enums';
import { AccountRefDto } from '../../accounts/dto/account.dto';

/**
 * How far a budget line has got.
 *
 * Read off the ledger and the voucher queue rather than stored: a column
 * saying "paid" is a column that goes on saying it after the voucher behind
 * it is cancelled.
 */
export type BudgetLineStatus = 'Not raised' | 'In progress' | 'Posted';

export class BudgetLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ description: 'The heading as it read on the day it was quoted' })
  label!: string;
  @ApiProperty() accountId!: number;
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty() fundId!: number;
  @ApiProperty({ nullable: true }) activityId!: number | null;
  @ApiProperty({ nullable: true }) partyId!: number | null;
  @ApiProperty({ nullable: true }) partyName!: string | null;
  @ApiProperty({ description: 'What the day was planned to cost under this head' })
  budgeted!: number;
  @ApiProperty({ description: 'What it actually cost, from the posted ledger' })
  actual!: number;
  @ApiProperty({ description: 'Actual less budgeted; positive is an overspend' })
  variance!: number;
  @ApiProperty({ description: 'False for what the temple bears itself' })
  chargedToSponsor!: boolean;
  @ApiProperty({ enum: ['Not raised', 'In progress', 'Posted'] })
  status!: BudgetLineStatus;
}

export class EventBudgetDto {
  @ApiProperty() eventId!: number;
  @ApiProperty({ nullable: true, description: 'The costing the figures were taken from' })
  costingId!: number | null;
  @ApiProperty({ nullable: true, description: 'What the sponsor was quoted' })
  sponsorAmount!: number | null;
  @ApiProperty({ nullable: true, description: 'What has actually been receipted from them' })
  sponsorReceived!: number | null;
  @ApiProperty({ type: () => [BudgetLineDto] }) lines!: BudgetLineDto[];
  @ApiProperty() budgetedTotal!: number;
  @ApiProperty() actualTotal!: number;
  @ApiProperty({ description: 'Actual less budgeted across every head' }) variance!: number;
  @ApiProperty({ description: 'Whether the budget may still be corrected' })
  isFrozen!: boolean;
  @ApiProperty({
    nullable: true,
    description: 'Why there is no budget yet, in the words the screen should use',
  })
  problem!: string | null;
}

/** One head this occurrence is expected to spend on. */
export class ExpectedLineDto {
  @ApiProperty() accountId!: number;
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

/**
 * What an occurrence is expected to cost, for a form filling itself in.
 *
 * Answered from the frozen budget where the day has been costed, and from the
 * costing in force where it has not. A form has no business preferring one to
 * the other: a day already quoted is owed the figure it was quoted at, and one
 * that has not been quoted yet is owed today's rate.
 */
export class ExpectedAmountsDto {
  @ApiProperty({ description: 'Whether these come from the day’s frozen budget' })
  costed!: boolean;
  @ApiProperty({ nullable: true, description: 'What the sponsor is asked for' })
  sponsorAmount!: number | null;
  @ApiProperty({ type: () => [ExpectedLineDto] })
  lines!: ExpectedLineDto[];
}

/** Where the money went, on a voucher raised from a budget. */
export class MovementDto {
  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  mode!: PaymentMode;

  @ApiPropertyOptional({ description: 'Required for anything that moves through a bank' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  chequeNo?: string | null;

  /*
   * The number on the temple's physical voucher book, which every entry
   * carries. Nothing about filling a form in from a budget changes that: the
   * paper is what the audit is done against, and a voucher the books cannot be
   * matched to the paper by is the one thing auto-fill must not make easy.
   */
  @ApiProperty({ description: 'The number on the temple’s physical voucher book' })
  @IsString()
  @IsNotEmpty({ message: 'The manual voucher number is required' })
  @MaxLength(60)
  manualVoucherNo!: string;
}

export class RaiseReceiptDto extends MovementDto {
  @ApiPropertyOptional({
    description: 'Overrides the quote, for the family who rounded up on the day',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
}

export class PaymentLineDto {
  @ApiProperty({ description: 'The costing line being settled, by its id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  budgetLineId!: number;

  @ApiPropertyOptional({ description: 'What was really paid, where it differs from the budget' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
}

/**
 * One payment voucher settling one or more budget lines.
 *
 * Every line must be payable to the same party, because a voucher names one
 * payee and one amount: the goods shop and the melam group are two documents,
 * two signatures and two receipts, not one.
 */
export class RaisePaymentDto extends MovementDto {
  @ApiProperty({ type: () => [PaymentLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PaymentLineDto)
  lines!: PaymentLineDto[];

  @ApiPropertyOptional({
    description: 'Who was paid, where the budget lines do not already say',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId?: number | null;

  @ApiPropertyOptional({ description: 'The name on the voucher, for a payee with no record' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  party?: string;
}
