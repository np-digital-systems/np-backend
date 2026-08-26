import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { TokenService } from './token.service';

const ENV: Record<string, string> = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_REFRESH_TTL: '30d',
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        JwtService,
        { provide: ConfigService, useValue: { get: (key: string) => ENV[key] } },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  it('converts the access token lifetime to seconds', () => {
    expect(service.accessTokenTtlSeconds()).toBe(900);
  });

  it('places the refresh token expiry roughly 30 days out', () => {
    const days = (service.refreshTokenExpiry().getTime() - Date.now()) / 86_400_000;

    expect(days).toBeCloseTo(30, 1);
  });

  it('issues high-entropy refresh tokens that are stored only as a hash', () => {
    const first = service.createRefreshToken();
    const second = service.createRefreshToken();

    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(64);
    expect(first.hash).toHaveLength(64);
    expect(first.hash).not.toContain(first.token);
    expect(service.hashRefreshToken(first.token)).toBe(first.hash);
  });

  it('signs an access token carrying the subject, role and session', async () => {
    const token = await service.signAccessToken({
      sub: 'user-1',
      name: 'Test User',
      role: 'admin',
      sid: 'session-1',
    });
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;

    expect(decoded).toMatchObject({
      sub: 'user-1',
      name: 'Test User',
      role: 'admin',
      sid: 'session-1',
    });
  });
});
