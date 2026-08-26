import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import type { ActorContext, AuthenticatedUser } from '../../common/types/authenticated-user';
import { PermissionsService } from '../auth/permissions.service';
import {
  QueryPaymentsDto,
  QueryRegisterDto,
  RecordPaymentDto,
  SanththaPaymentDto,
  SanththaRegisterRowDto,
  SanththaSummaryDto,
} from './dto/sanththa.dto';
import { SanththaService } from './sanththa.service';

@ApiTags('sanththa')
@ApiBearerAuth()
@Controller('sanththa')
export class SanththaController {
  constructor(
    private readonly sanththa: SanththaService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('register')
  @RequirePermissions('contribution:view')
  @ApiOperation({
    summary: 'The sanththa register',
    description:
      'Everyone with a member number. Phone numbers are withheld unless you hold user:manage.',
  })
  async register(
    @Query() query: QueryRegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<SanththaRegisterRowDto>> {
    return this.sanththa.register(query, await this.canSeeContact(user));
  }

  @Get('summary')
  @RequirePermissions('contribution:view')
  summary(@Query('year') year?: string): Promise<SanththaSummaryDto> {
    return this.sanththa.summary(year ? Number(year) : undefined);
  }

  @Get('payments')
  @RequirePermissions('contribution:view')
  async payments(
    @Query() query: QueryPaymentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<SanththaPaymentDto>> {
    return this.sanththa.payments(query, await this.canSeeContact(user));
  }

  @Post('payments')
  @RequirePermissions('contribution:record')
  @ApiOperation({ summary: 'Record a year’s subscription; one per member per year' })
  record(
    @Body() dto: RecordPaymentDto,
    @Actor() context: ActorContext,
  ): Promise<SanththaPaymentDto> {
    return this.sanththa.record(dto, context);
  }

  private async canSeeContact(user: AuthenticatedUser): Promise<boolean> {
    return (await this.permissions.forRole(user.role)).has('contribution:manage');
  }
}
