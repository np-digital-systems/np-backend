import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

import { ActorContext } from '../../common/types/authenticated-user';
import { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { SessionDto } from './dto/session.dto';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';

export const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** The name lives on the party, so every identity read hops through it. */
const IDENTITY_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  party: { select: { nameTa: true, nameEn: true } },
} satisfies Prisma.UserAccountSelect;

type IdentityRow = Prisma.UserAccountGetPayload<{ select: typeof IDENTITY_SELECT }>;

interface RequestContext {
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  static hashPassword(password: string): Promise<string> {
    return hash(password, ARGON_OPTIONS);
  }

  /** The signed-in identity, for GET /auth/me. */
  async identityOrFail(id: string): Promise<Omit<AuthUserDto, 'permissions'>> {
    const account = await this.prisma.userAccount.findUnique({
      where: { id },
      select: IDENTITY_SELECT,
    });

    if (!account) throw new UnauthorizedException('This account no longer exists');

    const { permissions: _ignored, ...identity } = this.toAuthUser(account, []);

    return identity;
  }

  async login(dto: LoginDto, context: RequestContext): Promise<AuthTokensDto> {
    const account = await this.prisma.userAccount.findUnique({
      where: { email: dto.email },
      select: { ...IDENTITY_SELECT, passwordHash: true },
    });

    const passwordMatches = account
      ? await verify(account.passwordHash, dto.password).catch(() => false)
      : await this.burnTime();

    if (!account || !passwordMatches) throw new UnauthorizedException('Invalid credentials');
    if (!account.isActive) throw new UnauthorizedException('This account is disabled');

    const { token, hash: tokenHash } = this.tokens.createRefreshToken();

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: {
          userId: account.id,
          tokenHash,
          deviceName: dto.deviceName ?? context.userAgent,
          ipAddress: context.ipAddress,
          expiresAt: this.tokens.refreshTokenExpiry(),
        },
        select: { id: true },
      });

      await tx.userAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() },
        select: { id: true },
      });

      return created;
    });

    const issued = await this.issue(account, session.id, token);

    await this.audit.record(
      {
        actor: {
          id: account.id,
          name: this.displayName(account),
          role: account.role,
          sessionId: session.id,
        },
        ipAddress: context.ipAddress,
      },
      { action: 'login', entity: 'user_session', entityRef: session.id, summary: 'Signed in' },
    );

    this.logger.log({ userId: account.id, sessionId: session.id }, 'User signed in');

    return issued;
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<AuthTokensDto> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        deviceName: true,
        expiresAt: true,
        revokedAt: true,
        account: { select: IDENTITY_SELECT },
      },
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (!session.account.isActive) throw new UnauthorizedException('This account is disabled');

    const rotated = this.tokens.createRefreshToken();

    const next = await this.prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
        select: { id: true },
      });

      return tx.userSession.create({
        data: {
          userId: session.account.id,
          tokenHash: rotated.hash,
          deviceName: session.deviceName,
          ipAddress: context.ipAddress,
          expiresAt: this.tokens.refreshTokenExpiry(),
        },
        select: { id: true },
      });
    });

    return this.issue(session.account, next.id, rotated.token);
  }

  async logout(context: ActorContext): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: context.actor.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record(context, {
      action: 'logout',
      entity: 'user_session',
      entityRef: context.actor.sessionId,
      summary: 'Signed out',
    });
  }

  async logoutAll(context: ActorContext): Promise<void> {
    const { count } = await this.prisma.userSession.updateMany({
      where: { userId: context.actor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record(context, {
      action: 'logout',
      entity: 'user_session',
      summary: `Signed out of ${count} session(s)`,
    });
  }

  async listSessions(context: ActorContext): Promise<SessionDto[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId: context.actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, deviceName: true, ipAddress: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => ({
      ...session,
      current: session.id === context.actor.sessionId,
    }));
  }

  async revokeSession(sessionId: string, context: ActorContext): Promise<void> {
    const { count } = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId: context.actor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (count === 0) throw new NotFoundException('No such active session');

    await this.audit.record(context, {
      action: 'logout',
      entity: 'user_session',
      entityRef: sessionId,
      summary: 'Revoked a session',
    });
  }

  async changePassword(dto: ChangePasswordDto, context: ActorContext): Promise<void> {
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }

    const account = await this.prisma.userAccount.findUnique({
      where: { id: context.actor.id },
      select: { passwordHash: true },
    });

    if (!account) throw new UnauthorizedException('This account no longer exists');

    const matches = await verify(account.passwordHash, dto.currentPassword).catch(() => false);
    if (!matches) throw new UnauthorizedException('The current password is incorrect');

    const passwordHash = await hash(dto.newPassword, ARGON_OPTIONS);

    await this.prisma.$transaction([
      this.prisma.userAccount.update({
        where: { id: context.actor.id },
        data: { passwordHash },
        select: { id: true },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: context.actor.id, revokedAt: null, id: { not: context.actor.sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record(context, {
      action: 'update',
      entity: 'user_account',
      entityRef: context.actor.id,
      summary: 'Changed their password; other sessions revoked',
    });
  }

  private async issue(
    account: IdentityRow,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthTokensDto> {
    const [accessToken, permissions] = await Promise.all([
      this.tokens.signAccessToken({
        sub: account.id,
        name: this.displayName(account),
        role: account.role,
        sid: sessionId,
      }),
      this.permissions.forRole(account.role),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTokenTtlSeconds(),
      user: this.toAuthUser(account, [...permissions]),
    };
  }

  private toAuthUser(account: IdentityRow, permissions: string[]): AuthUserDto {
    return {
      id: account.id,
      nameTa: account.party.nameTa,
      nameEn: account.party.nameEn,
      email: account.email,
      role: account.role,
      permissions,
    };
  }

  private displayName(account: IdentityRow): string {
    return account.party.nameEn ?? account.party.nameTa;
  }

  private async burnTime(): Promise<false> {
    await hash('timing-equalisation', ARGON_OPTIONS);

    return false;
  }
}
