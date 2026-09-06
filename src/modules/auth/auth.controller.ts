import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { Actor } from '../../common/decorators/actor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { ActorContext, AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from './auth.service';
import { AuthTokensDto, AuthUserDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SessionDto } from './dto/session.dto';
import { PermissionsService } from './permissions.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
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
  logout(@Actor() context: ActorContext): Promise<void> {
    return this.auth.logout(context);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session belonging to the signed-in user' })
  logoutAll(@Actor() context: ActorContext): Promise<void> {
    return this.auth.logoutAll(context);
  }

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'List the signed-in user’s active sessions' })
  sessions(@Actor() context: ActorContext): Promise<SessionDto[]> {
    return this.auth.listSessions(context);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one of the signed-in user’s sessions' })
  revokeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() context: ActorContext,
  ): Promise<void> {
    return this.auth.revokeSession(id, context);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change your own password; every other session is revoked' })
  changePassword(@Body() dto: ChangePasswordDto, @Actor() context: ActorContext): Promise<void> {
    return this.auth.changePassword(dto, context);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Return the signed-in user and their effective permissions' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserDto> {
    const [account, permissions] = await Promise.all([
      this.auth.identityOrFail(user.id),
      this.permissions.forRole(user.role),
    ]);

    return { ...account, permissions: [...permissions] };
  }

  private contextOf(request: FastifyRequest): { ipAddress: string; userAgent: string } {
    return {
      ipAddress: request.ip,
      userAgent: (request.headers['user-agent'] ?? 'unknown').slice(0, 120),
    };
  }
}
