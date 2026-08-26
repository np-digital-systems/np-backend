import { Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { UserRole } from '../../generated/prisma/enums';
import { PermissionGroupDto, RoleDto, SetRolePermissionsDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@RequirePermissions('role:manage')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List roles with their permissions and how many people hold each' })
  findAll(): Promise<RoleDto[]> {
    return this.roles.findAll();
  }

  @Get('permissions')
  @ApiOperation({ summary: 'The permission catalogue, grouped for the role editor' })
  catalogue(): Promise<PermissionGroupDto[]> {
    return this.roles.catalogue();
  }

  @Get(':code')
  findOne(@Param('code', new ParseEnumPipe(UserRole)) code: UserRole): Promise<RoleDto> {
    return this.roles.findOne(code);
  }

  @Put(':code/permissions')
  @ApiOperation({ summary: 'Replace the permissions granted to a role' })
  setPermissions(
    @Param('code', new ParseEnumPipe(UserRole)) code: UserRole,
    @Body() dto: SetRolePermissionsDto,
    @Actor() context: ActorContext,
  ): Promise<RoleDto> {
    return this.roles.setPermissions(code, dto, context);
  }
}
