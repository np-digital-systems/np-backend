import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { BankAccountType } from '../../../generated/prisma/enums';

export class BankAccountRefDto {
  @ApiProperty() id!: number;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: BankAccountType }) type!: BankAccountType;
  @ApiProperty() isActive!: boolean;
}

export class BankAccountDto extends BankAccountRefDto {
  @ApiProperty() bankName!: string;
  @ApiProperty() branch!: string;
  @ApiProperty({ description: 'Masked to the last four digits; the full number never leaves the server' })
  accountNumber!: string;
  @ApiProperty() openingBalance!: number;
  @ApiProperty() openedOn!: string;
  @ApiProperty({ description: 'The asset head every movement of this money posts through' })
  ledgerAccountId!: number;
}

export class BankAccountRecordDto extends BankAccountDto {
  @ApiProperty({ description: 'Derived from the ledger, not stored' }) balance!: number;
  @ApiProperty() entryCount!: number;
}

export class CreateBankAccountDto {
  @ApiProperty({ example: 'BOC Current' })
  @IsString()
  @MaxLength(120)
  label!: string;

  @ApiProperty({ example: 'Bank of Ceylon' })
  @IsString()
  @MaxLength(120)
  bankName!: string;

  @ApiProperty({ example: 'Chavakachcheri' })
  @IsString()
  @MaxLength(120)
  branch!: string;

  @ApiProperty({ example: '0071234567' })
  @IsString()
  @Matches(/^[0-9-]{6,34}$/, { message: 'accountNumber must be 6 to 34 digits or dashes' })
  accountNumber!: string;

  @ApiProperty({ enum: BankAccountType })
  @IsEnum(BankAccountType)
  type!: BankAccountType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;

  @ApiProperty({ example: '2020-01-15' })
  @IsDateString()
  openedOn!: string;

  @ApiProperty({ description: 'An asset head reserved for this bank account' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ledgerAccountId!: number;
}

export class UpdateBankAccountDto extends PartialType(
  OmitType(CreateBankAccountDto, ['ledgerAccountId', 'accountNumber'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryBankAccountsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;
}
