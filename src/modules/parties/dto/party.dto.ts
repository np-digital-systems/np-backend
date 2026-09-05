import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PartyKind } from '../../../generated/prisma/enums';

export class PartyDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Tamil name — the language the books are kept in' }) name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({
    enum: PartyKind,
    isArray: true,
    description:
      'Every role this party holds. A florist who also sponsors a pooja holds both; the roles group the list and never limit what the party may appear on.',
  })
  roles!: PartyKind[];
  @ApiProperty({ nullable: true, description: 'Set when this party also signs in' })
  userId!: string | null;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class PartyRecordDto extends PartyDto {
  @ApiProperty({ description: 'Posted entries naming this party' }) entryCount!: number;
  @ApiProperty({ description: 'Given to the temple — sponsorships and donations' })
  contributed!: number;
  @ApiProperty({ description: 'Paid out to them — honoraria, wages, invoices' }) paid!: number;
}

export class CreatePartyDto {
  @ApiProperty({ example: 'திரு. க. சபேசன்' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional({ example: 'K. Sabesan' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiPropertyOptional({
    enum: PartyKind,
    isArray: true,
    default: [PartyKind.devotee],
    description: 'Defaults to devotee when omitted',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(PartyKind, { each: true })
  roles?: PartyKind[];

  @ApiPropertyOptional({ description: 'Links this party to the person who signs in' })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
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
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  search?: string;
}
