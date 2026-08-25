import { ApiProperty } from '@nestjs/swagger';

export class PageMetaDto {
  @ApiProperty() readonly page: number;
  @ApiProperty() readonly limit: number;
  @ApiProperty() readonly total: number;
  @ApiProperty() readonly pageCount: number;
  @ApiProperty() readonly hasNextPage: boolean;

  constructor(page: number, limit: number, total: number) {
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.pageCount = limit > 0 ? Math.ceil(total / limit) : 0;
    this.hasNextPage = page < this.pageCount;
  }
}

export class PageDto<T> {
  @ApiProperty({ isArray: true })
  readonly data: T[];

  @ApiProperty({ type: PageMetaDto })
  readonly meta: PageMetaDto;

  constructor(data: T[], meta: PageMetaDto) {
    this.data = data;
    this.meta = meta;
  }
}
