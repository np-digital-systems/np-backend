import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PartyKind, PartyType } from '../../../generated/prisma/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : trim({ value });

export class PartyDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: PartyType }) type!: PartyType;
  @ApiProperty({ description: 'Tamil name — the language the books are kept in' }) name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({
    enum: PartyKind,
    isArray: true,
    description: 'Every role this party holds. Sponsorship is not among them: a sponsor profile is',
  })
  roles!: PartyKind[];
  @ApiProperty({ description: 'Whether a sponsor profile exists for this party' })
  isSponsor!: boolean;
  @ApiProperty({ nullable: true, description: 'Set when this party also signs in' })
  accountId!: string | null;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty({ nullable: true, description: 'Their account number with us, or ours with them' })
  referenceNo!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class PartyRecordDto extends PartyDto {
  @ApiProperty({ description: 'Posted entries naming this party' }) entryCount!: number;
  @ApiProperty({ description: 'Given to the temple — sponsorships and donations' })
  contributed!: number;
  @ApiProperty({ description: 'Paid out to them — honoraria, wages, invoices' }) paid!: number;
}

export class CreatePartyDto {
  @ApiPropertyOptional({ enum: PartyType, default: PartyType.person })
  @IsOptional()
  @IsEnum(PartyType)
  type?: PartyType;

  @ApiProperty({ example: 'திரு. க. சபேசன்' })
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional({ example: 'K. Sabesan' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  nameEn?: string | null;

  @ApiPropertyOptional({
    enum: PartyKind,
    isArray: true,
    description: 'May be empty — the electricity board is a party with no role',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PartyKind, { each: true })
  roles?: PartyKind[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(400)
  address?: string | null;

  @ApiPropertyOptional({ example: '0123456789', description: 'Electricity account, BR number' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  referenceNo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdatePartyDto extends PartialType(CreatePartyDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryPartiesDto {
  @ApiPropertyOptional({
    enum: PartyKind,
    description: 'Parties holding this role, among any others they hold',
  })
  @IsOptional()
  @IsEnum(PartyKind)
  kind?: PartyKind;

  @ApiPropertyOptional({ enum: PartyType })
  @IsOptional()
  @IsEnum(PartyType)
  type?: PartyType;

  @ApiPropertyOptional({ description: 'Only parties that hold a sponsor profile' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  sponsorsOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Year the contributed and paid totals are measured over' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;
}
