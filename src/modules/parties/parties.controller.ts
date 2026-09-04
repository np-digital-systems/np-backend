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
import { CreatePartyDto, PartyRecordDto, QueryPartiesDto, UpdatePartyDto } from './dto/party.dto';
import { PartiesService } from './parties.service';

@ApiTags('parties')
@ApiBearerAuth()
@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @RequirePermissions('party:view')
  @ApiOperation({ summary: 'Who entries are with — sponsors, staff, vendors and devotees' })
  findMany(@Query() query: QueryPartiesDto): Promise<PartyRecordDto[]> {
    return this.parties.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('party:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<PartyRecordDto> {
    return this.parties.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('party:manage')
  create(@Body() dto: CreatePartyDto, @Actor() context: ActorContext): Promise<PartyRecordDto> {
    return this.parties.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('party:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePartyDto,
    @Actor() context: ActorContext,
  ): Promise<PartyRecordDto> {
    return this.parties.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('party:manage')
  @ApiOperation({ summary: 'Retire a party; posted entries keep naming them' })
  deactivate(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<PartyRecordDto> {
    return this.parties.deactivate(id, context);
  }
}
