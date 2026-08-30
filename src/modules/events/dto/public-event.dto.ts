import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

import { FrequencyType } from '../../../generated/prisma/enums';

/**
 * An occurrence as the public website is allowed to see it.
 *
 * Deliberately not `EventRecordDto`: no sponsor, no audit stamps, no derived
 * `isOverdue`. Who paid for a pooja and which occurrences nobody has closed off
 * are the temple's business, not a visitor's. Both names travel so the site can
 * render the calendar in whichever language the visitor chose, and the raw
 * `frequencyType` / `instanceIdentifier` travel instead of a rendered English
 * label so the site can phrase "Week 24" in Tamil too.
 */
export class PublicEventDto {
  @ApiProperty() id!: number;
  @ApiProperty() eventTypeId!: number;
  @ApiProperty({ description: 'Tamil name — the language the calendar is kept in' })
  nameTa!: string;
  @ApiProperty({ description: 'English name; falls back to the Tamil one when unset' })
  nameEn!: string;
  @ApiProperty({ enum: FrequencyType }) frequencyType!: FrequencyType;
  @ApiProperty() instanceIdentifier!: number;
  @ApiProperty({ nullable: true, description: "The temple's own name for the day" })
  customInstanceName!: string | null;
  @ApiProperty({ example: '2026-10-01' }) scheduledDate!: string;
  @ApiProperty({ example: '18:30' }) startTime!: string;
  @ApiProperty({ nullable: true, example: '20:00' }) endTime!: string | null;
  @ApiProperty({ nullable: true, description: 'The public description of the occurrence' })
  notes!: string | null;
  @ApiProperty() isCompleted!: boolean;
}

export class PublicUpcomingQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 24, default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  limit?: number;
}

export class PublicCalendarQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Defaults to the start of this year' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2027-12-31',
    description: 'Defaults to the end of next year; at most 36 months after `from`',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
