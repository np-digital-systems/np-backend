import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Actor } from '../../common/decorators/actor.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { ActorContext } from '../../common/types/authenticated-user';
import { AssetsService } from './assets.service';
import {
  AssetCategoryTotalDto,
  AssetRecordDto,
  CreateAssetDto,
  DisposeAssetDto,
  QueryAssetsDto,
  UpdateAssetDto,
} from './dto/asset.dto';

@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermissions('asset:view')
  @ApiOperation({ summary: 'The asset register, with depreciation and book value worked out' })
  findMany(@Query() query: QueryAssetsDto): Promise<AssetRecordDto[]> {
    return this.assets.findMany(query);
  }

  @Get('by-category')
  @RequirePermissions('asset:view')
  byCategory(): Promise<AssetCategoryTotalDto[]> {
    return this.assets.byCategory();
  }

  @Get(':id')
  @RequirePermissions('asset:view')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<AssetRecordDto> {
    return this.assets.findOneOrFail(id);
  }

  @Post()
  @RequirePermissions('asset:manage')
  create(@Body() dto: CreateAssetDto, @Actor() context: ActorContext): Promise<AssetRecordDto> {
    return this.assets.create(dto, context);
  }

  @Patch(':id')
  @RequirePermissions('asset:manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssetDto,
    @Actor() context: ActorContext,
  ): Promise<AssetRecordDto> {
    return this.assets.update(id, dto, context);
  }

  @Post(':id/dispose')
  @RequirePermissions('asset:dispose')
  @ApiOperation({ summary: 'Write the asset off or sell it; dating the disposal stops depreciation' })
  dispose(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisposeAssetDto,
    @Actor() context: ActorContext,
  ): Promise<AssetRecordDto> {
    return this.assets.dispose(id, dto, context);
  }
}
