import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { EventTypeDto } from '../../event-types/dto/event-type.dto';
import { SponsorUserDto } from '../../sponsors/dto/sponsor.dto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EventRecordDto {
  @ApiProperty() id!: number;
  @ApiProperty() eventTypeId!: number;
  @ApiProperty() instanceIdentifier!: number;
  @ApiProperty({ nullable: true }) customInstanceName!: string | null;
  @ApiProperty({ example: '2026-10-01' }) scheduledDate!: string;
  @ApiProperty({ example: '18:30' }) startTime!: string;
  @ApiProperty({ nullable: true, example: '20:00' }) endTime!: string | null;
  @ApiProperty({ nullable: true }) sponsorId!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() isCompleted!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: EventTypeDto }) eventType!: EventTypeDto;
  @ApiProperty({ type: SponsorUserDto, nullable: true }) sponsor!: SponsorUserDto | null;
  @ApiProperty({ example: 'Week 24' }) instanceLabel!: string;
  @ApiProperty({ enum: ['Completed', 'Today', 'Pending Approval', 'Scheduled'] }) status!: string;
  @ApiProperty({ description: 'Past and nobody marked it done' }) isOverdue!: boolean;
}

export class ScheduleSlotDto {
  @ApiProperty() instanceIdentifier!: number;
  @ApiProperty() instanceLabel!: string;
  @ApiProperty({ nullable: true }) customInstanceName!: string | null;
  @ApiProperty({
    type: SponsorUserDto,
    nullable: true,
    description: 'The standing sponsor, if one is set',
  })
  defaultSponsor!: SponsorUserDto | null;
  @ApiProperty({ type: EventRecordDto, nullable: true }) event!: EventRecordDto | null;
}

export class ScheduleGroupDto {
  @ApiProperty({ type: EventTypeDto }) eventType!: EventTypeDto;
  @ApiProperty({ type: ScheduleSlotDto, isArray: true }) slots!: ScheduleSlotDto[];
  @ApiProperty() scheduledCount!: number;
  @ApiProperty() sponsoredCount!: number;
}

export class EventsSummaryDto {
  @ApiProperty() total!: number;
  @ApiProperty() upcoming!: number;
  @ApiProperty() completed!: number;
  @ApiProperty() unsponsored!: number;
}

export class CreateEventDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventTypeId!: number;

  @ApiProperty({ minimum: 1, maximum: 366 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  instanceIdentifier!: number;

  @ApiPropertyOptional({ description: "The temple's own name for the day" })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  customInstanceName?: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  scheduledDate!: string;

  @ApiProperty({ example: '18:30', description: '24-hour HH:mm' })
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiPropertyOptional({ example: '20:00' })
  @IsOptional()
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ description: 'Defaults to the standing sponsor for this slot' })
  @IsOptional()
  @IsUUID()
  sponsorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  customInstanceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  sponsorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class QueryEventsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  eventTypeId?: number;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ description: 'Only occurrences with nobody sponsoring them' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  unsponsoredOnly?: boolean;
}
