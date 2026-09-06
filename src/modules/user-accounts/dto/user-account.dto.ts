import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../common/password';
import { AccountRole } from '../../../generated/prisma/enums';

const lowerEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class UserAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'The party this sign-in belongs to' }) partyId!: number;
  @ApiProperty({ description: 'Read from the party — never edited here' }) nameTa!: string;
  @ApiProperty({ nullable: true }) nameEn!: string | null;
  @ApiProperty({ nullable: true, description: 'From the party; edit it in the directory' })
  phone!: string | null;
  @ApiProperty({ nullable: true, description: 'From the party; edit it in the directory' })
  address!: string | null;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: AccountRole }) role!: AccountRole;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true }) lastLoginAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

/**
 * A sign-in is granted to a party that already exists. Where it does not, pass
 * the name instead and the register gains a row before the account does.
 */
export class CreateUserAccountDto {
  @ApiPropertyOptional({ description: 'An existing party. Omit to register a new person' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId?: number;

  @ApiPropertyOptional({ description: 'Required when no partyId is given' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(160)
  nameTa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiProperty()
  @Transform(lowerEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ enum: AccountRole })
  @IsEnum(AccountRole)
  role!: AccountRole;
}

export class UpdateUserAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(lowerEmail)
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: AccountRole })
  @IsEnum(AccountRole)
  role!: AccountRole;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class QueryUserAccountsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AccountRole })
  @IsOptional()
  @IsEnum(AccountRole)
  role?: AccountRole;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
