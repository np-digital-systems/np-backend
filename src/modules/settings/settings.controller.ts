import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { AccountingSettingsDto, SettingDto, TempleSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings:manage')
  findAll(): Promise<SettingDto[]> {
    return this.settings.findAll();
  }

  @Patch('temple')
  @RequirePermissions('settings:manage')
  updateTemple(
    @Body() dto: TempleSettingsDto,
    @Actor() context: ActorContext,
  ): Promise<SettingDto> {
    return this.settings.updateTemple(dto, context);
  }

  @Patch('accounting')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Cash head, self-approval policy and the deposit alert window' })
  updateAccounting(
    @Body() dto: AccountingSettingsDto,
    @Actor() context: ActorContext,
  ): Promise<SettingDto> {
    return this.settings.updateAccounting(dto, context);
  }
}
