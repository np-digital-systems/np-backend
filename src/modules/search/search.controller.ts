import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { QuerySearchDto, SearchResultDto } from './dto/search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search across the portal',
    description:
      'Each source is gated by the permission guarding its own screen, so search never becomes a side door onto records you cannot otherwise open.',
  })
  find(
    @Query() query: QuerySearchDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SearchResultDto[]> {
    return this.search.search(query, user);
  }
}
