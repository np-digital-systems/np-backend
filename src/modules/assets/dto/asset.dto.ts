import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { AssetCategory, AssetCondition, AssetStatus } from '../../../generated/prisma/enums';

export class AssetRecordDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Physical tag written on the item or its case' }) tag!: string;
  @ApiProperty() name!: string;
  @ApiProperty() nameTa!: string;
  @ApiProperty({ enum: AssetCategory }) category!: AssetCategory;
  @ApiProperty() acquiredOn!: string;
  @ApiProperty() cost!: number;
  @ApiProperty({ description: 'Straight-line annual rate; zero for land and gold' })
  depreciationRate!: number;
  @ApiProperty() location!: string;
  @ApiProperty({ enum: AssetCondition }) condition!: AssetCondition;
  @ApiProperty({ enum: AssetStatus }) status!: AssetStatus;
  @ApiProperty() fundId!: number;
  @ApiProperty() fundName!: string;
  @ApiProperty({ nullable: true }) disposedOn!: string | null;
  @ApiProperty({ nullable: true }) disposalValue!: number | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() ageYears!: number;
  @ApiProperty() annualDepreciation!: number;
  @ApiProperty() accumulatedDepreciation!: number;
  @ApiProperty({ description: 'Cost less depreciation, never below zero' }) netBookValue!: number;
}

export class AssetCategoryTotalDto {
  @ApiProperty({ enum: AssetCategory }) category!: AssetCategory;
  @ApiProperty() count!: number;
  @ApiProperty() cost!: number;
  @ApiProperty() netBookValue!: number;
}

export class CreateAssetDto {
  @ApiProperty({ example: 'AST-0142' })
  @IsString()
  @MaxLength(60)
  tag!: string;

  @ApiProperty({ example: 'வெள்ளி வாகனம்' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiProperty({ enum: AssetCategory })
  @IsEnum(AssetCategory)
  category!: AssetCategory;

  @ApiProperty({ example: '2022-08-01' })
  @IsDateString()
  acquiredOn!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  cost!: number;

  @ApiPropertyOptional({ default: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  depreciationRate?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  location!: string;

  @ApiPropertyOptional({ enum: AssetCondition })
  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition;

  @ApiPropertyOptional({ enum: AssetStatus })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fundId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateAssetDto extends PartialType(OmitType(CreateAssetDto, ['tag'] as const)) {}

export class DisposeAssetDto {
  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  disposedOn!: string;

  @ApiPropertyOptional({ description: 'What the temple received for it' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  disposalValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class QueryAssetsDto {
  @ApiPropertyOptional({ enum: AssetCategory })
  @IsOptional()
  @IsEnum(AssetCategory)
  category?: AssetCategory;

  @ApiPropertyOptional({ enum: AssetStatus })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @ApiPropertyOptional({ enum: AssetCondition })
  @IsOptional()
  @IsEnum(AssetCondition)
  condition?: AssetCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fundId?: number;

  @ApiPropertyOptional({ description: 'Exclude disposed items' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  heldOnly?: boolean;
}
