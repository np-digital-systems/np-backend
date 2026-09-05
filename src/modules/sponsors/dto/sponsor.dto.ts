import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { FrequencyType, PartyKind } from '../../../generated/prisma/enums';

/**
 * A sponsor, as the calendar needs one.
 *
 * A party rather than an account. Sponsorship is a dealing the temple has with
 * somebody; whether that somebody can also sign in is a separate question, and
 * for most of them the answer is no.
 */
export class SponsorPartyDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Tamil name — the language the calendar is kept in' }) name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({
    nullable: true,
    description: 'From the linked sign-in. Null unless you hold event-sponsor:manage',
  })
  email!: string | null;
  @ApiProperty({ nullable: true, description: 'Null unless you hold event-sponsor:manage' })
  phone!: string | null;
  @ApiProperty({ description: 'From the linked sign-in; empty when there is none' })
  address!: string;
  @ApiProperty({ nullable: true, description: 'Set when this sponsor can also sign in' })
  userId!: string | null;
}

export class EventTypeSummaryDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Tamil name — the language the calendar is kept in' }) name!: string;
  @ApiProperty() nameEn!: string;
  @ApiProperty({ enum: FrequencyType }) frequencyType!: FrequencyType;
  @ApiProperty() noOfInstances!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class SponsorAssignmentDto {
  @ApiProperty() id!: number;
  @ApiProperty() eventTypeId!: number;
  @ApiProperty({ nullable: true, description: 'Null when the sponsor covers the whole event type' })
  instanceIdentifier!: number | null;
  @ApiProperty({ nullable: true }) customInstanceName!: string | null;
  @ApiProperty() partyId!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: EventTypeSummaryDto }) eventType!: EventTypeSummaryDto;
  @ApiProperty({ type: SponsorPartyDto }) sponsor!: SponsorPartyDto;
  @ApiProperty({ example: 'Week 24' }) instanceLabel!: string;
  @ApiProperty({ description: 'Dated occurrences this standing assignment covers this year' })
  occurrences!: number;
}

export class CreateSponsorDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventTypeId!: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 366,
    description: 'Omit to register the sponsor against every instance of the type',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  instanceIdentifier?: number;

  @ApiPropertyOptional({ description: "The temple's own name for the day, if it has one" })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  customInstanceName?: string;

  @ApiProperty({ description: 'The party sponsoring the slot' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId!: number;
}

export class UpdateSponsorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventTypeId?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 366,
    nullable: true,
    description: 'Send null to widen the sponsor back out to the whole event type',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  instanceIdentifier?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  customInstanceName?: string;
}

export class QuerySponsorsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventTypeId?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 366,
    description: 'Narrows to sponsors of this instance plus those covering the whole event type',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  instanceIdentifier?: number;

  @ApiPropertyOptional({
    description: 'Year the occurrence count is measured over; defaults to this year',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class QueryDirectoryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PartyKind,
    description:
      'Narrows the directory to parties holding this role. Omit to search every party — a florist asked to sponsor a pooja for the first time is found this way, and gains the role by being registered.',
  })
  @IsOptional()
  @IsEnum(PartyKind)
  kind?: PartyKind;
}
