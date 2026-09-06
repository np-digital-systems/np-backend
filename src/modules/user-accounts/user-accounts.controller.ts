import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import type { ActorContext } from '../../common/types/authenticated-user';
import {
  ChangeRoleDto,
  CreateUserAccountDto,
  QueryUserAccountsDto,
  ResetPasswordDto,
  UpdateUserAccountDto,
  UserAccountDto,
} from './dto/user-account.dto';
import { UserAccountsService } from './user-accounts.service';

@ApiTags('user-accounts')
@ApiBearerAuth()
@RequirePermissions('user:manage')
@Controller('user-accounts')
export class UserAccountsController {
  constructor(private readonly accounts: UserAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Sign-ins. Names come from the party and are edited there' })
  findMany(@Query() query: QueryUserAccountsDto): Promise<PageDto<UserAccountDto>> {
    return this.accounts.findMany(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserAccountDto> {
    return this.accounts.findByIdOrFail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Grant a sign-in to a party, registering the person if needed' })
  create(
    @Body() dto: CreateUserAccountDto,
    @Actor() context: ActorContext,
  ): Promise<UserAccountDto> {
    return this.accounts.create(dto, context);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change the sign-in email' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserAccountDto,
    @Actor() context: ActorContext,
  ): Promise<UserAccountDto> {
    return this.accounts.update(id, dto, context);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a role; sessions are revoked so it takes effect at once' })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @Actor() context: ActorContext,
  ): Promise<UserAccountDto> {
    return this.accounts.changeRole(id, dto, context);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password and revoke every session' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Actor() context: ActorContext,
  ): Promise<void> {
    return this.accounts.resetPassword(id, dto, context);
  }

  @Post(':id/sign-out')
  @ApiOperation({ summary: 'Revoke every session without disabling the account' })
  signOut(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() context: ActorContext,
  ): Promise<{ revoked: number }> {
    return this.accounts.signOutEverywhere(id, context);
  }

  @Post(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() context: ActorContext,
  ): Promise<UserAccountDto> {
    return this.accounts.setActive(id, true, context);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a sign-in; the party and its history remain' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() context: ActorContext,
  ): Promise<UserAccountDto> {
    return this.accounts.setActive(id, false, context);
  }
}
