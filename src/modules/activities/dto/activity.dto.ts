import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { ActivityKind } from '../../../generated/prisma/enums';

export class ActivityDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Tamil name — the language the books are kept in' }) name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ enum: ActivityKind }) kind!: ActivityKind;
  @ApiProperty({ nullable: true, description: 'Fund offered when this activity is chosen' })
  defaultFundId!: number | null;
  @ApiProperty({ nullable: true }) parentId!: number | null;
  @ApiProperty() isActive!: boolean;
}

export class ActivityRecordDto extends ActivityDto {
  @ApiProperty({ description: 'Posted entries coded to this activity' }) entryCount!: number;
  @ApiProperty({ description: 'Income posted against it this year' }) income!: number;
  @ApiProperty({ description: 'Expenditure posted against it this year' }) expenses!: number;
  @ApiProperty({ description: 'Income less expenditure — negative means it runs at a loss' })
  net!: number;
}

export class CreateActivityDto {
  @ApiProperty({ example: 'வெள்ளி அபிஷேகம்' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional({ example: 'Friday Abhishekam' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiPropertyOptional({ enum: ActivityKind, default: ActivityKind.general })
  @IsOptional()
  @IsEnum(ActivityKind)
  kind?: ActivityKind;

  @ApiPropertyOptional({ description: 'Offered on every voucher coded to this activity' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultFundId?: number | null;

  @ApiPropertyOptional({ description: 'Rolls up under a broader activity' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number | null;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryActivitiesDto {
  @ApiPropertyOptional({ enum: ActivityKind })
  @IsOptional()
  @IsEnum(ActivityKind)
  kind?: ActivityKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Year the income and expenditure are measured over' })
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
