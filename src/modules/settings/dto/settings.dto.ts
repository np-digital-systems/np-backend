import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class TempleSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) nameTa?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8) currency?: string;
}

export class AccountingSettingsDto {
  @ApiPropertyOptional({ description: 'The asset head that cash movements post through' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cashAccountId?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Whether the person who raised a voucher may also approve it. Off by default: approval is a second pair of eyes.',
  })
  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @ApiPropertyOptional({ default: 30, description: 'How early a deposit counts as maturing soon' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  depositMaturityAlertDays?: number;
}

export class SettingDto {
  @ApiProperty() key!: string;
  @ApiProperty() value!: Record<string, unknown>;
  @ApiProperty() updatedAt!: Date;
}

export interface AccountingSettings {
  cashAccountId: number | null;
  allowSelfApproval: boolean;
  depositMaturityAlertDays: number;
}
