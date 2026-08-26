import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { ActorContext } from '../../common/types/authenticated-user';
import { UserRole } from '../../generated/prisma/enums';
import { AuditAction } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PermissionsService } from '../auth/permissions.service';
import { PermissionGroupDto, RoleDto, SetRolePermissionsDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async findAll(): Promise<RoleDto[]> {
    const [roles, counts] = await Promise.all([
      this.prisma.role.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { permissions: { select: { permissionCode: true } } },
      }),
      this.prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
    ]);

    const byRole = new Map(counts.map((row) => [row.role, row._count._all]));

    return roles.map((role) => ({
      code: role.code,
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((entry) => entry.permissionCode).sort(),
      userCount: byRole.get(role.code) ?? 0,
    }));
  }

  async findOne(code: UserRole): Promise<RoleDto> {
    const role = (await this.findAll()).find((entry) => entry.code === code);

    if (!role) throw new NotFoundException(`Role ${code} was not found`);

    return role;
  }

  async catalogue(): Promise<PermissionGroupDto[]> {
    const groups = await this.prisma.permissionGroup.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { permissions: { orderBy: { sortOrder: 'asc' } } },
    });

    return groups.map((group) => ({
      code: group.code,
      label: group.label,
      description: group.description,
      permissions: group.permissions.map((permission) => ({
        code: permission.code,
        label: permission.label,
        groupCode: permission.groupCode,
      })),
    }));
  }

  async setPermissions(
    code: UserRole,
    dto: SetRolePermissionsDto,
    context: ActorContext,
  ): Promise<RoleDto> {
    const before = await this.findOne(code);

    const known = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissions } },
      select: { code: true },
    });

    const unknown = dto.permissions.filter(
      (permission) => !known.some((row) => row.code === permission),
    );

    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}`);
    }

    const KEYS_TO_THE_BUILDING = ['role:manage', 'user:manage'];

    if (code === UserRole.admin) {
      const dropped = KEYS_TO_THE_BUILDING.filter((key) => !dto.permissions.includes(key));

      if (dropped.length > 0) {
        throw new BadRequestException(
          `The administrator role must keep ${dropped.join(' and ')}, or nobody can administer the portal`,
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleCode: code } }),
      this.prisma.rolePermission.createMany({
        data: dto.permissions.map((permissionCode) => ({ roleCode: code, permissionCode })),
      }),
    ]);

    this.permissions.invalidate(code);

    const granted = dto.permissions.filter(
      (permission) => !before.permissions.includes(permission),
    );
    const revoked = before.permissions.filter(
      (permission) => !dto.permissions.includes(permission),
    );

    await this.audit.record(context, {
      action: AuditAction.permissionChange,
      entity: 'role',
      entityRef: code,
      summary: `Granted ${granted.length} and revoked ${revoked.length} permission(s) on ${code}`,
      diff: { granted, revoked },
    });

    return this.findOne(code);
  }
}
