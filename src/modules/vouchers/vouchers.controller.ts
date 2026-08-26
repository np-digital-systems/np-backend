import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import type { ActorContext, AuthenticatedUser } from '../../common/types/authenticated-user';
import { PermissionsService } from '../auth/permissions.service';
import {
  CreateVoucherDto,
  QueryVouchersDto,
  RejectVoucherDto,
  UpdateVoucherDto,
  VoucherRecordDto,
} from './dto/voucher.dto';
import { VouchersService } from './vouchers.service';

const MANAGE_ALL = 'voucher:manage-all';

@ApiTags('vouchers')
@ApiBearerAuth()
@Controller('vouchers')
export class VouchersController {
  constructor(
    private readonly vouchers: VouchersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('transaction:view')
  @ApiOperation({
    summary: 'List vouchers',
    description: 'Without voucher:manage-all the list is limited to vouchers you raised yourself.',
  })
  async findMany(
    @Query() query: QueryVouchersDto,
    @Actor() context: ActorContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<VoucherRecordDto>> {
    return this.vouchers.findMany(query, context, await this.canManageAll(user));
  }

  @Get(':id')
  @RequirePermissions('transaction:view')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.findOneOrFail(id, context, await this.canManageAll(user));
  }

  @Post()
  @RequirePermissions('voucher:create')
  @ApiOperation({
    summary: 'Raise a voucher as a draft; the ledger is untouched until it is posted',
  })
  create(@Body() dto: CreateVoucherDto, @Actor() context: ActorContext): Promise<VoucherRecordDto> {
    return this.vouchers.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('voucher:create')
  @ApiOperation({ summary: 'Edit a draft or rejected voucher; editing returns it to Draft' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVoucherDto,
    @Actor() context: ActorContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.update(id, dto, context, await this.canManageAll(user));
  }

  @Post(':id/submit')
  @RequirePermissions('voucher:submit')
  async submit(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.submit(id, context, await this.canManageAll(user));
  }

  @Post(':id/approve')
  @RequirePermissions('voucher:approve')
  @ApiOperation({ summary: 'Approve a submitted voucher. You cannot approve one you raised.' })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.approve(id, context);
  }

  @Post(':id/reject')
  @RequirePermissions('voucher:approve')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectVoucherDto,
    @Actor() context: ActorContext,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.reject(id, dto, context);
  }

  @Post(':id/post')
  @RequirePermissions('voucher:post')
  @ApiOperation({ summary: 'Write the double entry and freeze the voucher. Irreversible.' })
  post(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.post(id, context);
  }

  @Post(':id/cancel')
  @RequirePermissions('voucher:create')
  @ApiOperation({ summary: 'Withdraw a voucher that should never have been raised' })
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VoucherRecordDto> {
    return this.vouchers.cancel(id, context, await this.canManageAll(user));
  }

  private async canManageAll(user: AuthenticatedUser): Promise<boolean> {
    return (await this.permissions.forRole(user.role)).has(MANAGE_ALL);
  }
}
