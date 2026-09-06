import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { EventTypeDto } from '../../event-types/dto/event-type.dto';
import { SponsorPartyDto } from '../../sponsors/dto/sponsor.dto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EventRecordDto {
  @ApiProperty() id!: number;
  @ApiProperty() eventTypeId!: number;
  @ApiProperty() instanceIdentifier!: number;
  @ApiProperty({ nullable: true }) customInstanceName!: string | null;
  @ApiProperty({ example: '2026-10-01' }) scheduledDate!: string;
  @ApiProperty({ example: '18:30' }) startTime!: string;
  @ApiProperty({ nullable: true, example: '20:00' }) endTime!: string | null;
  @ApiProperty({ nullable: true }) sponsorPartyId!: number | null;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty() isCompleted!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: EventTypeDto }) eventType!: EventTypeDto;
  @ApiProperty({ type: SponsorPartyDto, nullable: true }) sponsor!: SponsorPartyDto | null;
  @ApiProperty({ example: 'Week 24' }) instanceLabel!: string;
  @ApiProperty({ enum: ['Completed', 'Today', 'Pending Approval', 'Scheduled'] }) status!: string;
  @ApiProperty({ description: 'Past and nobody marked it done' }) isOverdue!: boolean;
}

export class ScheduleSlotDto {
  @ApiProperty({ description: 'The slot row every sponsor and occurrence points at' })
  slotId!: number;
  @ApiProperty() instanceIdentifier!: number;
  @ApiProperty() instanceLabel!: string;
  @ApiProperty({ nullable: true }) customInstanceName!: string | null;
  @ApiProperty({
    type: SponsorPartyDto,
    nullable: true,
    description:
      'The sponsor offered by default — one registered against this instance, else one registered against the whole event type',
  })
  defaultSponsor!: SponsorPartyDto | null;
  @ApiProperty({
    type: SponsorPartyDto,
    isArray: true,
    description: 'Everyone who takes this slot — the shortlist a year is scheduled from',
  })
  sponsors!: SponsorPartyDto[];
  @ApiProperty({ description: 'How many registered sponsors stand for this slot' })
  sponsorCount!: number;
  @ApiProperty({
    description: 'Dates scheduled against this slot this year; a monthly slot carries several',
  })
  eventCount!: number;
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

  @ApiPropertyOptional({
    description:
      'The party sponsoring this occurrence. Defaults to the slot’s registered sponsor, when exactly one is registered',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sponsorPartyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEventDto {
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sponsorPartyId?: number;

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

/**
 * Someone who could be asked to give to this observance.
 *
 * "Contributor" is never stored: it is computed from what people actually gave
 * in earlier years, which is what makes the collection sheet open with last
 * year's names already on it.
 */
export class ContributorDto {
  @ApiProperty() partyId!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) nameEn!: string | null;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty({
    enum: ['gave-before', 'sponsor', 'vendor', 'devotee'],
    description: 'Why they are being offered — presentation only, never stored',
  })
  reason!: 'gave-before' | 'sponsor' | 'vendor' | 'devotee';
  @ApiProperty({ nullable: true, description: 'What they last gave to this observance' })
  lastAmount!: number | null;
  @ApiProperty({ nullable: true }) lastYear!: number | null;
  @ApiProperty({ description: 'Whether they have already given to this occurrence' })
  paidThisTime!: boolean;
  @ApiProperty({ nullable: true }) paidAmount!: number | null;
}
