import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';

import { Env } from '../../config/env.schema';
import { UserRole } from '../../generated/prisma/enums';
import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER } from './auth.constants';

export interface AccessTokenPayload {
  sub: string;
  name: string;
  role: UserRole;
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      audience: ACCESS_TOKEN_AUDIENCE,
      issuer: ACCESS_TOKEN_ISSUER,
    });
  }

  createRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');

    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  accessTokenTtlSeconds(): number {
    return this.toSeconds(this.config.get('JWT_ACCESS_TTL', { infer: true }));
  }

  refreshTokenExpiry(): Date {
    const seconds = this.toSeconds(this.config.get('JWT_REFRESH_TTL', { infer: true }));

    return new Date(Date.now() + seconds * 1_000);
  }

  private toSeconds(duration: string): number {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
    if (!match) throw new Error(`Unsupported duration: ${duration}`);

    const value = Number(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'ms':
        return Math.ceil(value / 1_000);
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3_600;
      default:
        return value * 86_400;
    }
  }
}
