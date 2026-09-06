import { Injectable } from '@nestjs/common';

import { AccountRole } from '../../generated/prisma/enums';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ROLE_PERMISSIONS_TTL_SECONDS } from './auth.constants';

interface CacheEntry {
  permissions: Set<string>;
  expiresAt: number;
}

@Injectable()
export class PermissionsService {
  private readonly cache = new Map<AccountRole, CacheEntry>();
  private readonly ttlMs = ROLE_PERMISSIONS_TTL_SECONDS * 1_000;

  constructor(private readonly prisma: PrismaService) {}

  async forRole(role: AccountRole): Promise<Set<string>> {
    const cached = this.cache.get(role);

    if (cached && cached.expiresAt > Date.now()) return cached.permissions;

    const rows = await this.prisma.rolePermission.findMany({
      where: { roleCode: role },
      select: { permissionCode: true },
    });

    const permissions = new Set(rows.map((row) => row.permissionCode));
    this.cache.set(role, { permissions, expiresAt: Date.now() + this.ttlMs });

    return permissions;
  }

  invalidate(role?: AccountRole): void {
    if (role) {
      this.cache.delete(role);
      return;
    }

    this.cache.clear();
  }
}
