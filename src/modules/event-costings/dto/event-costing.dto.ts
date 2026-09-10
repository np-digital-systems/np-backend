import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { AccountRefDto } from '../../accounts/dto/account.dto';

/** One item under a heading — what the quote shows a family. */
export class CostingItemDto {
  @ApiProperty() id!: number;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ description: 'Coconut, milk, curd' }) label!: string;
  @ApiProperty({ description: 'How many' }) quantity!: number;
  @ApiProperty({ description: 'What one costs' }) unitAmount!: number;
  @ApiProperty({ description: 'Quantity times the unit price' }) amount!: number;
}

/** One heading — the level that reaches the ledger. */
export class CostingLineDto {
  @ApiProperty() id!: number;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ nullable: true, description: 'Overrides the account name on the quote' })
  label!: string | null;
  @ApiProperty() accountId!: number;
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty() fundId!: number;
  @ApiProperty({ nullable: true }) activityId!: number | null;
  @ApiProperty({ nullable: true, description: 'Who is usually paid — a default, not a rule' })
  partyId!: number | null;
  @ApiProperty({ nullable: true }) partyName!: string | null;
  @ApiProperty() amount!: number;
  @ApiProperty({
    description: 'False for what the temple bears itself; the quote passes over it',
  })
  chargedToSponsor!: boolean;
  @ApiProperty({ type: () => [CostingItemDto], description: 'The itemisation, where there is one' })
  items!: CostingItemDto[];
}

export class CostingRecordDto {
  @ApiProperty() id!: number;
  @ApiProperty() eventTypeId!: number;
  @ApiProperty() eventTypeName!: string;
  @ApiProperty({ nullable: true, description: 'Null covers every instance of the type' })
  slotId!: number | null;
  @ApiProperty({ nullable: true, description: 'Which instance, in the temple’s own words' })
  slotLabel!: string | null;
  @ApiProperty({ example: '2026-04-01' }) effectiveFrom!: string;
  @ApiProperty({ nullable: true, description: 'Null means still in force' })
  effectiveTo!: string | null;
  @ApiProperty({ description: 'Whether this is the version being quoted from today' })
  isInForce!: boolean;
  @ApiProperty({ description: 'The lines charged to the sponsor, added up' })
  sponsorAmount!: number;
  @ApiProperty({
    description: 'The income head the receipt lands on, from the pooja type’s activity',
    nullable: true,
  })
  incomeAccountId!: number | null;
  @ApiProperty({ nullable: true }) incomeAccountName!: string | null;
  @ApiProperty({ nullable: true }) incomeFundId!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Why a receipt cannot be raised for this pooja yet',
  })
  codingProblem!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: () => [CostingLineDto] }) lines!: CostingLineDto[];
  @ApiProperty({ description: 'What the day is expected to cost, in full' })
  expenseTotal!: number;
  @ApiProperty({ description: 'The part of that the sponsor is asked to carry' })
  chargedTotal!: number;
  @ApiProperty({ description: 'What the temple bears itself — the lines not charged on' })
  templeShare!: number;
  @ApiProperty({
    description: 'Occurrences costed from this version; it is history once above zero',
  })
  usedByEvents!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class WriteCostingItemDto {
  @ApiProperty({ example: 'தேங்காய்' })
  @IsString()
  @MaxLength(160)
  label!: string;

  @ApiProperty({ description: 'How many', minimum: 0.001 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @ApiProperty({ description: 'What one costs', minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitAmount!: number;
}

/**
 * One expected cost as it is written.
 *
 * There is no fund and no activity here: both come from the pooja type's own
 * activity, which already answers them for every receipt the temple raises.
 * Asking again would be a second place for the same fact to be kept, and the
 * two would eventually disagree.
 */
export class WriteCostingLineDto {
  @ApiProperty({ description: 'The expense head this lands on' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  accountId!: number;

  @ApiPropertyOptional({ description: 'Who is usually paid for this' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId?: number | null;

  @ApiPropertyOptional({ description: 'Overrides the account name on the quote' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  label?: string | null;

  @ApiPropertyOptional({
    minimum: 0.01,
    description: 'Ignored where there are items: the items decide the figure',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  chargedToSponsor?: boolean;

  @ApiPropertyOptional({ type: () => [WriteCostingItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => WriteCostingItemDto)
  items?: WriteCostingItemDto[];
}

export class CreateCostingDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventTypeId!: number;

  @ApiPropertyOptional({
    description: 'Leave empty to cover every instance; name a slot only where one differs',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slotId?: number | null;

  @ApiPropertyOptional({
    description: 'Defaults to today. Occurrences from this date are quoted at this rate',
    example: '2026-04-01',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /*
   * A costing may be saved with nothing in it. The lines are written on the
   * editor that opens next, and demanding one here only to satisfy a rule of
   * the API's own making is what put a single expense line on a dialog whose
   * other five lived somewhere else.
   */
  @ApiPropertyOptional({ type: () => [WriteCostingLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WriteCostingLineDto)
  lines?: WriteCostingLineDto[];
}

/**
 * A revision rewrites the figures, never the scope.
 *
 * Moving a costing from one slot to another would silently reprice every
 * occurrence already dated against both, so the scope is fixed at creation and
 * a costing for a different slot is a different costing.
 *
 * The quote is not here either. It is the lines charged to the sponsor, added
 * up, and a figure that can be typed as well as calculated is a figure with two
 * answers.
 */
export class UpdateCostingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: () => [WriteCostingLineDto],
    description: 'Replaces every line; omit to leave them alone',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WriteCostingLineDto)
  lines?: WriteCostingLineDto[];
}

/** Day 2 of a festival is day 1 with three figures changed. */
export class CopyCostingDto {
  @ApiPropertyOptional({
    description: 'The slot to copy onto; leave empty to cover the whole type',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slotId?: number | null;

  @ApiPropertyOptional({ description: 'Defaults to the period the original starts in' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

export class QueryCostingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventTypeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slotId?: number;

  @ApiPropertyOptional({ description: 'Only the versions being quoted from today' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  inForce?: boolean;

  @ApiPropertyOptional({
    description: 'Only versions in force on this date',
    example: '2026-06-25',
  })
  @IsOptional()
  @IsDateString()
  on?: string;
}

export class ResolveCostingDto {
  @ApiProperty({ description: 'The instance being costed' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  slotId!: number;

  @ApiProperty({ example: '2026-06-25' })
  @IsDateString()
  on!: string;
}

/** The one-line answer a calendar screen needs before it offers to cost a day. */
export class CostingSummaryDto {
  @ApiProperty({ nullable: true }) costingId!: number | null;
  @ApiProperty({ nullable: true }) sponsorAmount!: number | null;
  @ApiProperty({ nullable: true }) expenseTotal!: number | null;
  @ApiProperty({
    nullable: true,
    description: 'Why nothing applies, in the words the screen should use',
  })
  problem!: string | null;
}
