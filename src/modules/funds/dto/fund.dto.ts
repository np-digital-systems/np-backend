import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class FundRefDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() nameTa!: string;
}

export class FundDto extends FundRefDto {
  @ApiProperty() opening!: number;
  @ApiProperty() income!: number;
  @ApiProperty() expenses!: number;
  @ApiProperty() isActive!: boolean;
}

export class FundRecordDto extends FundDto {
  @ApiProperty({ description: 'Opening plus income less expenditure; never stored' })
  balance!: number;
  @ApiProperty({ description: 'Share of what was available that has been spent' })
  utilisation!: number;
  @ApiProperty() projectCount!: number;
  @ApiProperty({ description: 'Budget committed to this fund’s projects' }) committed!: number;
  @ApiProperty() entryCount!: number;
}

export class FundBreakdownLineDto {
  @ApiProperty() accountId!: number;
  @ApiProperty() accountName!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() share!: number;
}

export class CreateFundDto {
  @ApiProperty({ example: 'பொது நிதி' })
  @IsString()
  @MaxLength(160)
  nameTa!: string;

  @ApiPropertyOptional({ example: 'General fund' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;
}

export class UpdateFundDto extends PartialType(CreateFundDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryFundsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  financialYearId?: number;
}
