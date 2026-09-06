import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermissionsService } from './permissions.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  imports: [PassportModule.register({ session: false }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PermissionsService, JwtStrategy],
  exports: [AuthService, PermissionsService],
})
export class AuthModule {}
