import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { FrequencyType } from '../../../generated/prisma/enums';

export class EventTypeDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Tamil name — the language the calendar is kept in' }) name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ enum: FrequencyType }) frequencyType!: FrequencyType;
  @ApiProperty({ description: 'How many instances a full year of this type contains' })
  noOfInstances!: number;
  @ApiProperty({
    nullable: true,
    description: 'Activity a receipt for this pooja is coded to; it carries the fund in turn',
  })
  activityId!: number | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class EventTypeRecordDto extends EventTypeDto {
  @ApiProperty({ description: 'Sponsors registered against this type' }) sponsorSlots!: number;
  @ApiProperty({ description: 'Dated occurrences on the calendar for the active year' })
  scheduledCount!: number;
}

export class CreateEventTypeDto {
  @ApiProperty({ example: 'வெள்ளிக்கிழமை பூஜை' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional({ example: 'Friday Pooja' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiProperty({ enum: FrequencyType })
  @IsEnum(FrequencyType)
  frequencyType!: FrequencyType;

  @ApiProperty({ minimum: 1, maximum: 366 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  noOfInstances!: number;

  @ApiPropertyOptional({
    description: 'Activity a receipt for this pooja is coded to; it carries the fund in turn',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  activityId?: number | null;
}

export class UpdateEventTypeDto extends PartialType(CreateEventTypeDto) {}

export class QueryEventTypesDto {
  @ApiPropertyOptional({ enum: FrequencyType })
  @IsOptional()
  @IsEnum(FrequencyType)
  frequencyType?: FrequencyType;

  @ApiPropertyOptional({ description: 'Year the occurrence counts are measured over' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  search?: string;
}
