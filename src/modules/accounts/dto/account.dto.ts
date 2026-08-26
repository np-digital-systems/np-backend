import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { AccountType } from '../../../generated/prisma/enums';

export class AccountRefDto {
  @ApiProperty() id!: number;
  @ApiProperty() code!: string;
  @ApiProperty({ description: 'Romanisation; falls back to the Tamil name' }) name!: string;
  @ApiProperty() nameTa!: string;
  @ApiProperty({ enum: AccountType }) type!: AccountType;
}

export class AccountDto extends AccountRefDto {
  @ApiProperty({ nullable: true }) parentId!: number | null;
  @ApiProperty() isPostable!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() openingBalance!: number;
  @ApiProperty() createdAt!: Date;
}

export class AccountRecordDto extends AccountDto {
  @ApiProperty({ type: AccountRefDto, nullable: true }) parent!: AccountRefDto | null;
  @ApiProperty({ description: 'Posted ledger entries in the active year' }) entryCount!: number;
  @ApiProperty({ description: 'Opening balance plus the year’s postings, derived from the ledger' })
  balance!: number;
}

export class CreateAccountDto {
  @ApiProperty({ example: '4100' })
  @IsString()
  @Matches(/^\d{3,10}$/, { message: 'code must be 3 to 10 digits' })
  code!: string;

  @ApiProperty({ example: 'காணிக்கை' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional({ example: 'Hundial collection' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  type!: AccountType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number;

  @ApiPropertyOptional({ default: true, description: 'A grouping head is not postable' })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @ApiPropertyOptional({ description: 'Must be zero for income and expense heads' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;
}

export class UpdateAccountDto extends PartialType(
  OmitType(CreateAccountDto, ['code', 'type'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryAccountsDto {
  @ApiPropertyOptional({ enum: AccountType })
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Only heads that entries may post against' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  postableOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Year the balance is measured over; defaults to the current year' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;
}
