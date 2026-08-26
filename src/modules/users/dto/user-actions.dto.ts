import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserRole } from '../../../generated/prisma/enums';

export class ChangeRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class EnrolMemberDto {
  @ApiPropertyOptional({
    description: 'Defaults to today. The member number is allocated by the database.',
  })
  @IsOptional()
  @IsDateString()
  joinedOn?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Membership and the annual subscription are separate',
  })
  @IsOptional()
  @IsBoolean()
  subscribes?: boolean;
}

export class SubscriptionDto {
  @ApiProperty()
  @IsBoolean()
  subscribes!: boolean;
}
