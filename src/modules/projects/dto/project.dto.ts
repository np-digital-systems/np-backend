import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';

import { ProjectStatus } from '../../../generated/prisma/enums';

export class ProjectRefDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() fundId!: number;
  @ApiProperty() isActive!: boolean;
}

export class ProjectDto extends ProjectRefDto {
  @ApiProperty() nameTa!: string;
  @ApiProperty({ nullable: true }) budget!: number | null;
  @ApiProperty() startDate!: string;
  @ApiProperty({ nullable: true }) targetDate!: string | null;
  @ApiProperty({ enum: ProjectStatus }) status!: ProjectStatus;
  @ApiProperty() description!: string;
}

export class ProjectRecordDto extends ProjectDto {
  @ApiProperty() fundName!: string;
  @ApiProperty() spent!: number;
  @ApiProperty() received!: number;
  @ApiProperty({ nullable: true }) remaining!: number | null;
  @ApiProperty({ nullable: true }) utilisation!: number | null;
  @ApiProperty() isOverBudget!: boolean;
  @ApiProperty() entryCount!: number;
}

export class CreateProjectDto {
  @ApiProperty({ example: 'திருப்பணி' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fundId!: number;

  @ApiPropertyOptional({ description: 'Null for open-ended work with no agreed ceiling' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  budget?: number;

  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({ description: 'Whether a voucher may still post against it' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryProjectsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fundId?: number;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

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
