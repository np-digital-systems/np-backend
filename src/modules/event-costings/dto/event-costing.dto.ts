import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CostingStatus } from '../../../generated/prisma/enums';
import { AccountRefDto } from '../../accounts/dto/account.dto';

/** One item under a heading — what the quote shows a family. */
export class CostingItemDto {
  @ApiProperty() id!: number;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ description: 'Ten coconuts, two litres of milk' }) label!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ nullable: true }) quantity!: number | null;
  @ApiProperty({ nullable: true }) unitAmount!: number | null;
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
  @ApiProperty({ enum: CostingStatus }) status!: CostingStatus;
  @ApiProperty({ description: 'What the sponsor is quoted' }) sponsorAmount!: number;
  @ApiProperty() incomeAccountId!: number;
  @ApiProperty() incomeFundId!: number;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: () => [CostingLineDto] }) lines!: CostingLineDto[];
  @ApiProperty({ description: 'What the day is expected to cost, in full' })
  expenseTotal!: number;
  @ApiProperty({ description: 'The part of that the sponsor is asked to carry' })
  chargedTotal!: number;
  @ApiProperty({
    description: 'Quote less what the sponsor carries — the temple’s own share, or its shortfall',
  })
  templeShare!: number;
  @ApiProperty({
    description: 'Occurrences costed from this version; it is history once above zero',
  })
  usedByEvents!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class WriteCostingItemDto {
  @ApiProperty({ example: 'தேங்காய் 10' })
  @IsString()
  @MaxLength(160)
  label!: string;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ description: 'Documentation for the quote; the amount stays the truth' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitAmount?: number | null;
}

/**
 * One expected cost as it is written.
 *
 * Items carry no coding of their own: they inherit the head, the fund, the
 * activity and the party of the heading they sit under, because an itemisation
 * that could be coded elsewhere would be a second set of books.
 */
export class WriteCostingLineDto {
  @ApiProperty({ description: 'The expense head this lands on' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  accountId!: number;

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
  activityId?: number | null;

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

  @ApiProperty({ minimum: 0.01, description: 'Must equal the items where there are any' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

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

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ description: 'What the sponsor is quoted', minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sponsorAmount!: number;

  @ApiProperty({ description: 'The income head the sponsor’s receipt lands on' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  incomeAccountId!: number;

  @ApiProperty({ description: 'The fund that receipt is carried in' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  incomeFundId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiProperty({ type: () => [WriteCostingLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => WriteCostingLineDto)
  lines!: WriteCostingLineDto[];
}

/**
 * A revision rewrites the figures, never the scope.
 *
 * Moving a costing from one slot to another would silently reprice every
 * occurrence already dated against both, so the scope is fixed at creation and
 * a costing for a different slot is a different costing.
 */
export class UpdateCostingDto {
  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sponsorAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  incomeAccountId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  incomeFundId?: number;

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
  @ArrayMinSize(1)
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

  @ApiPropertyOptional({ enum: CostingStatus })
  @IsOptional()
  @IsEnum(CostingStatus)
  status?: CostingStatus;

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
