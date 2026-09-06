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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import type { ActorContext, AuthenticatedUser } from '../../common/types/authenticated-user';
import { PermissionsService } from '../auth/permissions.service';
import {
  EnrolSponsorDto,
  QuerySponsorRegisterDto,
  SponsorDto,
  SponsorRegisterRowDto,
  UpdateSponsorProfileDto,
} from './dto/sponsor-registry.dto';
import { SponsorsService } from './sponsors.service';

const MANAGE = 'sponsor:manage';

@ApiTags('sponsors')
@ApiBearerAuth()
@Controller('sponsors')
export class SponsorsController {
  constructor(
    private readonly sponsors: SponsorsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('sponsor:view')
  @ApiOperation({ summary: 'The sponsor register, with sanththa status for the year' })
  async register(
    @Query() query: QuerySponsorRegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<SponsorRegisterRowDto>> {
    return this.sponsors.register(query, await this.canSeeContact(user));
  }

  @Get(':partyId')
  @RequirePermissions('sponsor:view')
  async findOne(
    @Param('partyId', ParseIntPipe) partyId: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SponsorDto> {
    return this.sponsors.findOneOrFail(partyId, await this.canSeeContact(user));
  }

  @Post()
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Enrol a sponsor; the database allocates the sponsor number' })
  enrol(@Body() dto: EnrolSponsorDto, @Actor() context: ActorContext): Promise<SponsorDto> {
    return this.sponsors.enrol(dto, context);
  }

  @Patch(':partyId')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Edit a sponsor; names and contact detail are written to the party' })
  update(
    @Param('partyId', ParseIntPipe) partyId: number,
    @Body() dto: UpdateSponsorProfileDto,
    @Actor() context: ActorContext,
  ): Promise<SponsorDto> {
    return this.sponsors.update(partyId, dto, context);
  }

  @Delete(':partyId')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Retire a sponsor; their party and history remain' })
  retire(
    @Param('partyId', ParseIntPipe) partyId: number,
    @Actor() context: ActorContext,
  ): Promise<SponsorDto> {
    return this.sponsors.retire(partyId, context);
  }

  private async canSeeContact(user: AuthenticatedUser): Promise<boolean> {
    return (await this.permissions.forRole(user.role)).has(MANAGE);
  }
}
