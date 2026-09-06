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
import { AccountRole, AuditAction, PartyType } from '../../generated/prisma/enums';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ARGON_OPTIONS } from '../auth/auth.service';
import {
  ChangeRoleDto,
  CreateUserAccountDto,
  QueryUserAccountsDto,
  ResetPasswordDto,
  UpdateUserAccountDto,
  UserAccountDto,
} from './dto/user-account.dto';

const ACCOUNT_SELECT = {
  id: true,
  partyId: true,
  email: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  party: { select: { nameTa: true, nameEn: true, phone: true, address: true } },
} satisfies Prisma.UserAccountSelect;

type AccountRow = Prisma.UserAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

/**
 * Sign-ins. Credentials only — a name, phone or address is edited on the party
 * through PartiesService, never here.
 */
@Injectable()
export class UserAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findMany(query: QueryUserAccountsDto): Promise<PageDto<UserAccountDto>> {
    const where: Prisma.UserAccountWhereInput = {
      role: query.role,
      isActive: query.isActive,
      OR: query.search
        ? [
            { email: { contains: query.search, mode: 'insensitive' } },
            { party: { nameTa: { contains: query.search, mode: 'insensitive' } } },
            { party: { nameEn: { contains: query.search, mode: 'insensitive' } } },
          ]
        : undefined,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userAccount.findMany({
        where,
        select: ACCOUNT_SELECT,
        orderBy: { createdAt: query.order },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.userAccount.count({ where }),
    ]);

    return new PageDto(rows.map(toDto), new PageMetaDto(query.page, query.limit, total));
  }

  async findByIdOrFail(id: string): Promise<UserAccountDto> {
    const account = await this.prisma.userAccount.findUnique({
      where: { id },
      select: ACCOUNT_SELECT,
    });

    if (!account) throw new NotFoundException(`Account ${id} was not found`);

    return toDto(account);
  }

  async create(dto: CreateUserAccountDto, context: ActorContext): Promise<UserAccountDto> {
    if (!dto.partyId && !dto.nameTa) {
      throw new BadRequestException('Give either an existing partyId or a name to register');
    }

    const passwordHash = await hash(dto.password, ARGON_OPTIONS);

    const account = await this.prisma.$transaction(async (tx) => {
      const partyId = dto.partyId ?? (await this.registerPerson(tx, dto));

      const party = await tx.party.findUnique({
        where: { id: partyId },
        select: { id: true, type: true, isActive: true, account: { select: { id: true } } },
      });

      if (!party) throw new NotFoundException(`Party ${partyId} was not found`);
      if (party.type !== PartyType.person) {
        throw new BadRequestException('Only a person can hold a sign-in');
      }
      if (!party.isActive) throw new BadRequestException('That party is no longer active');
      if (party.account) throw new ConflictException('That party already has a sign-in');

      return tx.userAccount.create({
        data: { partyId, email: dto.email, passwordHash, role: dto.role },
        select: ACCOUNT_SELECT,
      });
    });

    await this.audit.record(context, {
      action: 'create',
      entity: 'user_account',
      entityRef: account.id,
      summary: `Created a ${account.role} sign-in for ${displayName(account)}`,
    });

    return toDto(account);
  }

  async update(
    id: string,
    dto: UpdateUserAccountDto,
    context: ActorContext,
  ): Promise<UserAccountDto> {
    const before = await this.findByIdOrFail(id);

    const account = await this.prisma.userAccount.update({
      where: { id },
      data: { email: dto.email },
      select: ACCOUNT_SELECT,
    });

    await this.audit.record(context, {
      action: 'update',
      entity: 'user_account',
      entityRef: id,
      summary: `Updated the sign-in for ${displayName(account)}`,
      diff: AuditService.diff({ ...before }, { ...toDto(account) }),
    });

    return toDto(account);
  }

  async changeRole(id: string, dto: ChangeRoleDto, context: ActorContext): Promise<UserAccountDto> {
    const before = await this.findByIdOrFail(id);

    if (before.role === dto.role) return before;

    this.assertNotSelf(id, context, 'You cannot change your own role');

    if (before.role === AccountRole.admin) await this.assertNotLastAdmin(id);

    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userAccount.update({
        where: { id },
        data: { role: dto.role },
        select: ACCOUNT_SELECT,
      });

      await tx.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return updated;
    });

    await this.audit.record(context, {
      action: AuditAction.permissionChange,
      entity: 'user_account',
      entityRef: id,
      summary: `Changed ${displayName(account)} from ${before.role} to ${dto.role}`,
      diff: { role: { from: before.role, to: dto.role } },
    });

    return toDto(account);
  }

  async resetPassword(id: string, dto: ResetPasswordDto, context: ActorContext): Promise<void> {
    const account = await this.findByIdOrFail(id);
    const passwordHash = await hash(dto.password, ARGON_OPTIONS);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id },
        data: { passwordHash },
        select: { id: true },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record(context, {
      action: 'update',
      entity: 'user_account',
      entityRef: id,
      summary: `Reset the password for ${account.nameEn ?? account.nameTa}; all sessions revoked`,
    });
  }

  async signOutEverywhere(id: string, context: ActorContext): Promise<{ revoked: number }> {
    const account = await this.findByIdOrFail(id);

    const { count } = await this.prisma.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record(context, {
      action: 'logout',
      entity: 'user_account',
      entityRef: id,
      summary: `Signed ${account.nameEn ?? account.nameTa} out of ${count} device(s)`,
    });

    return { revoked: count };
  }

  async setActive(id: string, isActive: boolean, context: ActorContext): Promise<UserAccountDto> {
    const before = await this.findByIdOrFail(id);

    if (before.isActive === isActive) return before;

    if (!isActive) {
      this.assertNotSelf(id, context, 'You cannot deactivate your own account');
      if (before.role === AccountRole.admin) await this.assertNotLastAdmin(id);
    }

    const account = await this.prisma.$transaction(async (tx) => {
      if (!isActive) {
        await tx.userSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return tx.userAccount.update({ where: { id }, data: { isActive }, select: ACCOUNT_SELECT });
    });

    await this.audit.record(context, {
      action: isActive ? 'update' : 'delete',
      entity: 'user_account',
      entityRef: id,
      summary: `${isActive ? 'Reactivated' : 'Deactivated'} the sign-in for ${displayName(account)}`,
    });

    return toDto(account);
  }

  private async registerPerson(
    tx: Prisma.TransactionClient,
    dto: CreateUserAccountDto,
  ): Promise<number> {
    const party = await tx.party.create({
      data: {
        type: PartyType.person,
        nameTa: dto.nameTa!,
        nameEn: dto.nameEn ?? null,
        email: dto.email,
      },
      select: { id: true },
    });

    return party.id;
  }

  private assertNotSelf(id: string, context: ActorContext, message: string): void {
    if (id === context.actor.id) throw new ForbiddenException(message);
  }

  private async assertNotLastAdmin(id: string): Promise<void> {
    const others = await this.prisma.userAccount.count({
      where: { role: AccountRole.admin, isActive: true, id: { not: id } },
    });

    if (others === 0) throw new ConflictException('This is the last active administrator');
  }
}

function toDto(account: AccountRow): UserAccountDto {
  return {
    id: account.id,
    partyId: account.partyId,
    nameTa: account.party.nameTa,
    nameEn: account.party.nameEn,
    phone: account.party.phone,
    address: account.party.address,
    email: account.email,
    role: account.role,
    isActive: account.isActive,
    lastLoginAt: account.lastLoginAt,
    createdAt: account.createdAt,
  };
}

function displayName(account: AccountRow): string {
  return account.party.nameEn ?? account.party.nameTa;
}
