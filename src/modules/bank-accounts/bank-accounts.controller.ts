import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { BankAccountsService } from './bank-accounts.service';
import {
  BankAccountRecordDto,
  CreateBankAccountDto,
  QueryBankAccountsDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';

@ApiTags('bank-accounts')
@ApiBearerAuth()
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @Get()
  @RequirePermissions('bank-account:view')
  @ApiOperation({ summary: 'Bank accounts with balances derived from the ledger' })
  findMany(@Query() query: QueryBankAccountsDto): Promise<BankAccountRecordDto[]> {
    return this.bankAccounts.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('bank-account:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<BankAccountRecordDto> {
    return this.bankAccounts.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('bank-account:manage')
  create(
    @Body() dto: CreateBankAccountDto,
    @Actor() context: ActorContext,
  ): Promise<BankAccountRecordDto> {
    return this.bankAccounts.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('bank-account:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankAccountDto,
    @Actor() context: ActorContext,
  ): Promise<BankAccountRecordDto> {
    return this.bankAccounts.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('bank-account:manage')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<BankAccountRecordDto> {
    return this.bankAccounts.close(id, context);
  }
}
