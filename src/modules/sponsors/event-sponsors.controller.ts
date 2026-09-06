import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  CreateSponsorDto,
  QueryDirectoryDto,
  QuerySponsorsDto,
  SponsorAssignmentDto,
  SponsorPartyDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import { SponsorsService } from './sponsors.service';

const MANAGE = 'event-sponsor:manage';

@ApiTags('sponsors')
@ApiBearerAuth()
@Controller('sponsors')
export class SponsorsController {
  constructor(
    private readonly sponsors: SponsorsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  @RequirePermissions('event-sponsor:view')
  @ApiOperation({
    summary: 'Sponsors registered against event types',
    description:
      'Filter by eventTypeId, and optionally by instanceIdentifier — which keeps the sponsors registered against the whole type, since they stand for every instance of it. Contact details are omitted from the payload unless you hold event-sponsor:manage; they are withheld at the server, not hidden in the client.',
  })
  async findMany(
    @Query() query: QuerySponsorsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SponsorAssignmentDto[]> {
    return this.sponsors.findMany(query, await this.canSeeContact(user));
  }

  @Get('directory')
  @RequirePermissions('event-sponsor:view')
  @ApiOperation({ summary: 'Everyone in the directory who could be registered as a sponsor' })
  async directory(
    @Query() query: QueryDirectoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PageDto<SponsorPartyDto>> {
    return this.sponsors.directory(query, await this.canSeeContact(user));
  }

  @Get(':id')
  @RequirePermissions('event-sponsor:view')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SponsorAssignmentDto> {
    return this.sponsors.findOne(id, await this.canSeeContact(user));
  }

  @Post()
  @RequirePermissions(MANAGE)
  @ApiOperation({
    summary: 'Register a sponsor against an event type',
    description: 'Omit instanceIdentifier to have them stand for every instance of the type.',
  })
  create(
    @Body() dto: CreateSponsorDto,
    @Actor() context: ActorContext,
  ): Promise<SponsorAssignmentDto> {
    return this.sponsors.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSponsorDto,
    @Actor() context: ActorContext,
  ): Promise<SponsorAssignmentDto> {
    return this.sponsors.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions(MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @Actor() context: ActorContext): Promise<void> {
    return this.sponsors.remove(id, context);
  }

  private async canSeeContact(user: AuthenticatedUser): Promise<boolean> {
    return (await this.permissions.forRole(user.role)).has(MANAGE);
  }
}
