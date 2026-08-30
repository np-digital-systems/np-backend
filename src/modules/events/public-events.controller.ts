import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import {
  PublicCalendarQueryDto,
  PublicEventDto,
  PublicUpcomingQueryDto,
} from './dto/public-event.dto';
import { EventsService } from './events.service';

/**
 * The temple calendar as the public website reads it.
 *
 * Separate from EventsController rather than a flag on it: these routes carry
 * no bearer token, so the shape they return has to be safe by construction
 * rather than by remembering to pass `canSeeContact: false`. Nothing here
 * exposes a sponsor, and nothing here writes.
 */
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
