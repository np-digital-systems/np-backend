import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserView, UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List users and members' })
  findMany(@Query() query: QueryUsersDto): Promise<PageDto<UserView>> {
    return this.users.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.findByIdOrFail(id);
  }

  @Post()
  @RequirePermissions('users:create')
  @ApiOperation({ summary: 'Create a user; supplying joinedOn enrols them on the register' })
  create(@Body() dto: CreateUserDto): Promise<UserView> {
    return this.users.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<UserView> {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('users:delete')
  @ApiOperation({ summary: 'Deactivate a user and revoke their sessions' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.deactivate(id);
  }
}
