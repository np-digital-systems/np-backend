import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from './auth.service';
import { AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { PermissionsService } from './permissions.service';
import { UsersService } from '../users/users.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for an access and refresh token pair' })
  login(@Body() dto: LoginDto, @Req() request: FastifyRequest): Promise<AuthTokensDto> {
    return this.auth.login(dto, this.contextOf(request));
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  refresh(@Body() dto: RefreshDto, @Req() request: FastifyRequest): Promise<AuthTokensDto> {
    return this.auth.refresh(dto.refreshToken, this.contextOf(request));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logout(user.sessionId);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session belonging to the signed-in user' })
  logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logoutAll(user.id);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Return the signed-in user and their effective permissions' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserDto> {
    const [profile, permissions] = await Promise.all([
      this.users.findByIdOrFail(user.id),
      this.permissions.forRole(user.role),
    ]);

    return {
      id: profile.id,
      nameTa: profile.nameTa,
      fullName: profile.fullName,
      email: profile.email,
      role: profile.role,
      permissions: [...permissions],
    };
  }

  private contextOf(request: FastifyRequest): { ipAddress: string; userAgent: string } {
    return {
      ipAddress: request.ip,
      userAgent: (request.headers['user-agent'] ?? 'unknown').slice(0, 120),
    };
  }
}
