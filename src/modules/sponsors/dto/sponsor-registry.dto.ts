import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : trim({ value });

/** A sponsor: the party's identity, plus the profile that makes them one. */
export class SponsorDto {
  @ApiProperty({ description: 'The party id — a sponsor is a party, not a separate record' })
  partyId!: number;
  @ApiProperty({ description: 'Allocated by the database and never changed' }) sponsorNo!: string;
  @ApiProperty() name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) address!: string | null;
  @ApiProperty() sponsorSince!: Date;
  @ApiProperty({ description: 'Whether the annual sanththa is due from them' })
  subscribes!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ description: 'Standing sponsorships across every observance' })
  sponsorships!: number;
}

export class SponsorRegisterRowDto extends SponsorDto {
  @ApiProperty({ isArray: true, type: Number }) paidYears!: number[];
  @ApiProperty() totalPaid!: number;
  @ApiProperty() paidThisYear!: boolean;
}

/** Enrol a sponsor. Give an existing party, or a name to register one. */
export class EnrolSponsorDto {
  @ApiPropertyOptional({ description: 'An existing party. Omit to register a new person' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId?: number;

  @ApiPropertyOptional({ description: 'Required when no partyId is given' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  nameTa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  nameEn?: string | null;

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

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  sponsorSince?: string;

  @ApiPropertyOptional({ default: true, description: 'Set false for an exempt sponsor' })
  @IsOptional()
  @IsBoolean()
  subscribes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/**
 * Editing a sponsor edits the party behind them, which is why a rename here
 * renames them on every screen at once.
 */
export class UpdateSponsorProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  nameTa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  nameEn?: string | null;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subscribes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class QuerySponsorRegisterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Year the payment status is measured against' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year?: number;

  @ApiPropertyOptional({ description: 'Only sponsors who owe the sanththa and have not paid' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  outstandingOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
