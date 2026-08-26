import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsString, Matches } from 'class-validator';

import { UserRole } from '../../../generated/prisma/enums';

export class PermissionDto {
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty() groupCode!: string;
}

export class PermissionGroupDto {
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: PermissionDto, isArray: true }) permissions!: PermissionDto[];
}

export class RoleDto {
  @ApiProperty({ enum: UserRole }) code!: UserRole;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ description: 'System roles cannot be removed' }) isSystem!: boolean;
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
  @ApiProperty({ description: 'Active users holding this role' }) userCount!: number;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: String, isArray: true, example: ['dashboard:view', 'event:view'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z-]+:[a-z-]+$/, {
    each: true,
    message: 'each permission must look like "group:action"',
  })
  permissions!: string[];
}
