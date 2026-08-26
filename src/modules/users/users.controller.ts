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
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ChangeRoleDto,
  EnrolMemberDto,
  ResetPasswordDto,
  SubscriptionDto,
} from './dto/user-actions.dto';
import { UserView, UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@RequirePermissions('user:manage')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users, filterable by role, activity and the sanththa register' })
  findMany(@Query() query: QueryUsersDto): Promise<PageDto<UserView>> {
    return this.users.findMany(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.findByIdOrFail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a user; supplying joinedOn enrols them on the register' })
  create(@Body() dto: CreateUserDto, @Actor() context: ActorContext): Promise<UserView> {
    return this.users.create(dto, context);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a profile. Role changes go through PATCH /users/:id/role' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Actor() context: ActorContext,
  ): Promise<UserView> {
    return this.users.update(id, dto, context);
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Change a role; the user’s sessions are revoked so it takes effect at once',
  })
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeRoleDto,
    @Actor() context: ActorContext,
  ): Promise<UserView> {
    return this.users.changeRole(id, dto, context);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password for a staff account and revoke its sessions' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Actor() context: ActorContext,
  ): Promise<void> {
    return this.users.resetPassword(id, dto, context);
  }

  @Post(':id/enrol')
  @ApiOperation({
    summary: 'Enrol someone on the sanththa register; the database allocates the number',
  })
  enrol(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrolMemberDto,
    @Actor() context: ActorContext,
  ): Promise<UserView> {
    return this.users.enrol(id, dto, context);
  }

  @Patch(':id/subscription')
  @ApiOperation({ summary: 'Start or stop a member’s subscription' })
  setSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubscriptionDto,
    @Actor() context: ActorContext,
  ): Promise<UserView> {
    return this.users.setSubscription(id, dto, context);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Reactivate a deactivated account' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() context: ActorContext,
  ): Promise<UserView> {
    return this.users.setActive(id, true, context);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a user and revoke their sessions' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Actor() context: ActorContext,
  ): Promise<UserView> {
    return this.users.setActive(id, false, context);
  }
}
