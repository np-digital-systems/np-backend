import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  NotificationCategoryWire,
  type WireNotificationCategory,
} from '../../../common/enums/wire';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { NotificationPriority } from '../../../generated/prisma/enums';

export class NotificationMetaDto {
  @ApiProperty() @IsString() @MaxLength(60) label!: string;
  @ApiProperty() @IsString() @MaxLength(200) value!: string;
}

export class NotificationDto {
  @ApiProperty({ description: 'Serialised as a string; the column is a bigint' }) id!: string;
  @ApiProperty({ enum: NotificationCategoryWire.values }) category!: WireNotificationCategory;
  @ApiProperty({ enum: NotificationPriority }) priority!: NotificationPriority;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ nullable: true }) entityType!: string | null;
  @ApiProperty({ nullable: true }) entityRef!: string | null;
  @ApiProperty({ nullable: true }) actionLabel!: string | null;
  @ApiProperty({ nullable: true }) actionPage!: string | null;
  @ApiProperty({ type: NotificationMetaDto, isArray: true, nullable: true })
  meta!: NotificationMetaDto[] | null;
  @ApiProperty() timestamp!: Date;
  @ApiProperty() read!: boolean;
  @ApiProperty() dismissible!: boolean;
}

export class NotificationCountsDto {
  @ApiProperty() total!: number;
  @ApiProperty() unread!: number;
}

export class CreateNotificationDto {
  @ApiProperty({ enum: NotificationCategoryWire.values })
  @IsIn(NotificationCategoryWire.values)
  category!: WireNotificationCategory;

  @ApiPropertyOptional({ enum: NotificationPriority })
  @IsOptional()
  @IsIn(Object.values(NotificationPriority))
  priority?: NotificationPriority;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityRef?: string;

  @ApiPropertyOptional({ description: 'Both the label and the page must be given, or neither' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  actionLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  actionPage?: string;

  @ApiPropertyOptional({ type: NotificationMetaDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationMetaDto)
  meta?: NotificationMetaDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dismissible?: boolean;

  @ApiPropertyOptional({ description: 'Roles to notify; defaults to every active staff role' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];
}

export class QueryNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationCategoryWire.values })
  @IsOptional()
  @IsIn(NotificationCategoryWire.values)
  category?: WireNotificationCategory;

  @ApiPropertyOptional({ description: 'Only what you have not read yet' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}
