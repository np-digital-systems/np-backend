import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import {
  PublicCalendarQueryDto,
  PublicEventDto,
  PublicUpcomingQueryDto,
} from './dto/public-event.dto';
import { EventsService } from './events.service';

// Separate controller so unauthenticated responses are safe by construction: read-only, and only
// a sponsor's name, never their contact details.
@ApiTags('public')
@Public()
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Get('upcoming')
  @ApiOperation({ summary: 'The next occurrences that have not been completed' })
  upcoming(@Query() query: PublicUpcomingQueryDto): Promise<PublicEventDto[]> {
    return this.events.publicUpcoming(query.limit ?? 6);
  }

  @Get()
  @ApiOperation({ summary: 'Every occurrence in a window, for the website calendar' })
  calendar(@Query() query: PublicCalendarQueryDto): Promise<PublicEventDto[]> {
    return this.events.publicCalendar(query.from, query.to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One occurrence, for its detail page' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<PublicEventDto> {
    return this.events.publicFindOneOrFail(id);
  }
}
