import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

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
  ) {}

  static hashPassword(password: string): Promise<string> {
    return hash(password, ARGON_OPTIONS);
  }

  async login(dto: LoginDto, context: RequestContext): Promise<AuthTokensDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        nameTa: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });

    const passwordMatches =
      user?.passwordHash !== undefined && user?.passwordHash !== null
        ? await verify(user.passwordHash, dto.password).catch(() => false)
        : await this.burnTime();

    if (!user || !passwordMatches) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('This account is disabled');

    const { token, hash: tokenHash } = this.tokens.createRefreshToken();

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: {
          userId: user.id,
          tokenHash,
          deviceName: dto.deviceName ?? context.userAgent,
          ipAddress: context.ipAddress,
          expiresAt: this.tokens.refreshTokenExpiry(),
        },
        select: { id: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        select: { id: true },
      });

      return created;
    });

    this.logger.log({ userId: user.id, sessionId: session.id }, 'User signed in');

    return this.issue(user, session.id, token);
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<AuthTokensDto> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);

    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            nameTa: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (!session.user.isActive) throw new UnauthorizedException('This account is disabled');

    const rotated = this.tokens.createRefreshToken();

    const next = await this.prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
        select: { id: true },
      });

      return tx.userSession.create({
        data: {
          userId: session.user.id,
          tokenHash: rotated.hash,
          deviceName: 'rotated',
          ipAddress: context.ipAddress,
          expiresAt: this.tokens.refreshTokenExpiry(),
        },
        select: { id: true },
      });
    });

    return this.issue(session.user, next.id, rotated.token);
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(
    user: Omit<AuthUserDto, 'permissions'>,
    sessionId: string,
    refreshToken: string,
  ): Promise<AuthTokensDto> {
    const [accessToken, permissions] = await Promise.all([
      this.tokens.signAccessToken({ sub: user.id, role: user.role, sid: sessionId }),
      this.permissions.forRole(user.role),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTokenTtlSeconds(),
      user: { ...user, permissions: [...permissions] },
    };
  }

  private async burnTime(): Promise<false> {
    await hash('timing-equalisation', ARGON_OPTIONS);

    return false;
  }
}
