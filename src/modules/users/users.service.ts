import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';

import { PageDto, PageMetaDto } from '../../common/dto/page.dto';
import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditAction, UserRole } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ARGON_OPTIONS } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ChangeRoleDto,
  EnrolMemberDto,
  ResetPasswordDto,
  SubscriptionDto,
} from './dto/user-actions.dto';

const USER_SELECT = {
  id: true,
  nameTa: true,
  fullName: true,
  email: true,
  phone: true,
  address: true,
  role: true,
  isActive: true,
  memberNo: true,
  joinedOn: true,
  subscribes: true,
  lastLoginAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type UserView = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryUsersDto): Promise<PageDto<UserView>> {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      isActive: query.isActive,
      memberNo: query.membersOnly ? { not: null } : undefined,
      subscribes: query.subscribes,
      OR: query.search
        ? [
            { nameTa: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { memberNo: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: query.order },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return new PageDto(data, new PageMetaDto(query.page, query.limit, total));
  }

  async findByIdOrFail(id: string): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });

    if (!user) throw new NotFoundException(`User ${id} was not found`);

    return user;
  }

  async create(dto: CreateUserDto, context: ActorContext): Promise<UserView> {
    const role = dto.role ?? UserRole.user;

    if (role !== UserRole.user && (!dto.email || !dto.password)) {
      throw new BadRequestException('Staff accounts require both an email and a password');
    }

    const user = await this.prisma.user.create({
      data: {
        nameTa: dto.nameTa,
        fullName: dto.fullName,
        email: dto.email,
        passwordHash: dto.password ? await hash(dto.password, ARGON_OPTIONS) : undefined,
        phone: dto.phone,
        address: dto.address ?? '',
        role,
        joinedOn: dto.joinedOn ? new Date(dto.joinedOn) : undefined,
        subscribes: dto.subscribes ?? false,
        notes: dto.notes,
      },
      select: USER_SELECT,
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'user',
      entityRef: user.id,
      summary: `Created ${role} ${user.fullName ?? user.nameTa}`,
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, context: ActorContext): Promise<UserView> {
    const before = await this.findByIdOrFail(id);

    const data = {
      nameTa: dto.nameTa,
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
      joinedOn: dto.joinedOn ? new Date(dto.joinedOn) : undefined,
      subscribes: dto.subscribes,
      notes: dto.notes,
    };

    const user = await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });

    await this.audit.record(context, {
      action: 'update',
      entity: 'user',
      entityRef: id,
      summary: `Updated ${user.fullName ?? user.nameTa}`,
      diff: AuditService.diff(before, user),
    });

    return user;
  }

  async changeRole(id: string, dto: ChangeRoleDto, context: ActorContext): Promise<UserView> {
    const before = await this.findByIdOrFail(id);

    if (before.role === dto.role) return before;

    this.assertNotSelf(id, context, 'You cannot change your own role');

    if (dto.role !== UserRole.user && !before.email) {
      throw new BadRequestException('Give this person an email address before making them staff');
    }

    if (before.role === UserRole.admin) await this.assertNotLastAdmin(id);

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { role: dto.role },
        select: USER_SELECT,
      });

      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return updated;
    });

    await this.audit.record(context, {
      action: AuditAction.permissionChange,
      entity: 'user',
      entityRef: id,
      summary: `Changed ${user.fullName ?? user.nameTa} from ${before.role} to ${dto.role}`,
      diff: { role: { from: before.role, to: dto.role } },
    });

    return user;
  }

  async resetPassword(id: string, dto: ResetPasswordDto, context: ActorContext): Promise<void> {
    const user = await this.findByIdOrFail(id);

    if (user.role === UserRole.user) {
      throw new BadRequestException('Devotee accounts do not sign in and have no password');
    }

    const passwordHash = await hash(dto.password, ARGON_OPTIONS);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash }, select: { id: true } }),
      this.prisma.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record(context, {
      action: 'update',
      entity: 'user',
      entityRef: id,
      summary: `Reset the password for ${user.fullName ?? user.nameTa}; all sessions revoked`,
    });
  }

  async enrol(id: string, dto: EnrolMemberDto, context: ActorContext): Promise<UserView> {
    const before = await this.findByIdOrFail(id);

    if (before.memberNo) {
      throw new ConflictException(`Already on the register as ${before.memberNo}`);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        joinedOn: dto.joinedOn ? new Date(dto.joinedOn) : new Date(),
        subscribes: dto.subscribes ?? false,
      },
      select: USER_SELECT,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'user',
      entityRef: id,
      summary: `Enrolled ${user.fullName ?? user.nameTa} on the register as ${user.memberNo}`,
    });

    return user;
  }

  async setSubscription(
    id: string,
    dto: SubscriptionDto,
    context: ActorContext,
  ): Promise<UserView> {
    const before = await this.findByIdOrFail(id);

    if (!before.memberNo) {
      throw new BadRequestException(
        'Enrol this person on the register before setting a subscription',
      );
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { subscribes: dto.subscribes },
      select: USER_SELECT,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'user',
      entityRef: id,
      summary: `${dto.subscribes ? 'Started' : 'Stopped'} the subscription for ${user.memberNo}`,
    });

    return user;
  }

  /**
   * Sign somebody out of every device without touching their account.
   *
   * Distinct from deactivating: a phone left at the temple should be revoked
   * without also stopping the person from signing in tomorrow.
   */
  async signOutEverywhere(id: string, context: ActorContext): Promise<{ revoked: number }> {
    const user = await this.findByIdOrFail(id);

    const { count } = await this.prisma.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record(context, {
      action: 'logout',
      entity: 'user',
      entityRef: id,
      summary: `Signed ${user.fullName ?? user.nameTa} out of ${count} device(s)`,
    });

    return { revoked: count };
  }

  async setActive(id: string, isActive: boolean, context: ActorContext): Promise<UserView> {
    const before = await this.findByIdOrFail(id);

    if (before.isActive === isActive) return before;

    if (!isActive) {
      this.assertNotSelf(id, context, 'You cannot deactivate your own account');
      if (before.role === UserRole.admin) await this.assertNotLastAdmin(id);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      if (!isActive) {
        await tx.userSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return tx.user.update({ where: { id }, data: { isActive }, select: USER_SELECT });
    });

    await this.audit.record(context, {
      action: isActive ? 'update' : 'delete',
      entity: 'user',
      entityRef: id,
      summary: `${isActive ? 'Reactivated' : 'Deactivated'} ${user.fullName ?? user.nameTa}`,
    });

    return user;
  }

  private assertNotSelf(id: string, context: ActorContext, message: string): void {
    if (id === context.actor.id) throw new ForbiddenException(message);
  }

  private async assertNotLastAdmin(id: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: { role: UserRole.admin, isActive: true, id: { not: id } },
    });

    if (others === 0) {
      throw new ConflictException('This is the last active administrator');
    }
  }
}
