import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PageDto } from '../../common/dto/page.dto';
import { BookDto, LedgerRecordDto, QueryBookDto, QueryLedgerDto } from './dto/ledger.dto';
import { LedgerService } from './ledger.service';

@ApiTags('ledger')
@ApiBearerAuth()
@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('ledger')
  @RequirePermissions('transaction:view')
  @ApiOperation({ summary: 'Posted double-entry lines. Nothing writes here directly.' })
  findMany(@Query() query: QueryLedgerDto): Promise<PageDto<LedgerRecordDto>> {
    return this.ledger.findMany(query);
  }

  @Get('cash-book')
  @RequirePermissions('cash-book:view')
  @ApiOperation({ summary: 'Every posted movement through the cash head, with a running balance' })
  cashBook(@Query() query: QueryBookDto): Promise<BookDto> {
    return this.ledger.cashBook(query);
  }

  @Get('bank-book')
  @RequirePermissions('bank-book:view')
  @ApiOperation({ summary: 'Every posted movement through one bank account' })
  bankBook(@Query() query: QueryBookDto): Promise<BookDto> {
    return this.ledger.bankBook(query);
  }
}
