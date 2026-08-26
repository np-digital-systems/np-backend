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
import {
  CreateProjectDto,
  ProjectRecordDto,
  QueryProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermissions('project:view')
  @ApiOperation({ summary: 'Projects with spend read off the ledger' })
  findMany(@Query() query: QueryProjectsDto): Promise<ProjectRecordDto[]> {
    return this.projects.findMany(query);
  }

  @Get(':id')
  @RequirePermissions('project:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<ProjectRecordDto> {
    return this.projects.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('project:manage')
  create(@Body() dto: CreateProjectDto, @Actor() context: ActorContext): Promise<ProjectRecordDto> {
    return this.projects.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('project:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
    @Actor() context: ActorContext,
  ): Promise<ProjectRecordDto> {
    return this.projects.update(id, dto, context);
  }

  @Delete(':id')
  @RequirePermissions('project:manage')
  @ApiOperation({ summary: 'Mark the work complete and stop it taking new entries' })
  close(
    @Param('id', ParseIntPipe) id: number,
    @Actor() context: ActorContext,
  ): Promise<ProjectRecordDto> {
    return this.projects.close(id, context);
  }
}
