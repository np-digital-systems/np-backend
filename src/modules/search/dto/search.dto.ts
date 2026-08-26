import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength, IsOptional } from 'class-validator';

export const SEARCH_TYPES = [
  'User',
  'Event',
  'Receipt',
  'Payment',
  'Fund',
  'Project',
  'Fixed Deposit',
  'Asset',
  'Sanththa',
  'Financial Year',
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export class SearchResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SEARCH_TYPES }) type!: SearchType;
  @ApiProperty() title!: string;
  @ApiProperty() subtitle!: string;
  @ApiProperty({ nullable: true }) meta!: string | null;
  @ApiProperty({ nullable: true }) ref!: string | null;
  @ApiProperty({ nullable: true }) badge!: string | null;
  @ApiProperty({ description: 'The portal page this result lives on' }) page!: string;
}

export class QuerySearchDto {
  @ApiProperty({ minLength: 2 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  perType?: number;
}
