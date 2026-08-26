import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { AccountsService } from './accounts.service';
import {
  AccountRecordDto,
  CreateAccountDto,
  QueryAccountsDto,
  UpdateAccountDto,
} from './dto/account.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('account:view')
  @ApiOperation({ summary: 'The chart of accounts, with balances derived from the ledger' })
  findMany(@Query() query: QueryAccountsDto): Promise<AccountRecordDto[]> {
    return this.accounts.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('account:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<AccountRecordDto> {
    return this.accounts.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('account:manage')
  create(@Body() dto: CreateAccountDto, @Actor() context: ActorContext): Promise<AccountRecordDto> {
    return this.accounts.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('account:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAccountDto,
    @Actor() context: ActorContext,
  ): Promise<AccountRecordDto> {
    return this.accounts.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('account:manage')
  @ApiOperation({ summary: 'Deactivate a head; posted history is never removed' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<AccountRecordDto> {
    return this.accounts.deactivate(id, context);
  }
}
