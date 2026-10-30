import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { VoucherStatusWire } from '../../../common/enums/wire';
import type { WireVoucherStatus } from '../../../common/enums/wire';
import { EntrySide, PaymentMode, VoucherKind } from '../../../generated/prisma/enums';
import { AccountRefDto } from '../../accounts/dto/account.dto';
import { BankAccountRefDto } from '../../bank-accounts/dto/bank-account.dto';
import { FundRefDto } from '../../funds/dto/fund.dto';
import { ProjectRefDto } from '../../projects/dto/project.dto';

class VoucherActorDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

class VoucherLineDto {
  @ApiProperty() id!: number;
  @ApiProperty({ description: 'Order on the document, from 1' }) lineNo!: number;
  @ApiProperty() accountId!: number;
  @ApiProperty() amount!: number;
  @ApiProperty() fundId!: number;
  @ApiProperty({ nullable: true }) projectId!: number | null;
  @ApiProperty({ nullable: true, description: 'What this line was for' })
  activityId!: number | null;
  @ApiProperty({ nullable: true, description: 'The occurrence this line is for' })
  eventId!: number | null;
  @ApiProperty({ nullable: true, description: 'The deposit whose interest this line receipts' })
  fixedDepositId!: number | null;
  @ApiProperty({ enum: EntrySide, nullable: true, description: 'Journal lines only' })
  side!: EntrySide | null;
  @ApiProperty({ type: AccountRefDto }) account!: AccountRefDto;
  @ApiProperty({ type: FundRefDto }) fund!: FundRefDto;
  @ApiProperty({ type: ProjectRefDto, nullable: true }) project!: ProjectRefDto | null;
}

// Only a journal line states its side; on every other kind it follows from the kind, and the cash/bank
// contra is generated on posting. A contra's single line is the cash or bank head the money went to.
export class WriteVoucherLineDto {
  @ApiProperty({ description: 'The head this line hits' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  accountId!: number;

  @ApiProperty({ minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ description: 'The fund this line is carried in' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fundId!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId?: number | null;

  @ApiPropertyOptional({ description: 'What this line was for — a pooja, a service' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  activityId?: number | null;

  @ApiPropertyOptional({
    description: 'The occurrence this line is for — which Friday, not merely a Friday',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventId?: number | null;

  @ApiPropertyOptional({ description: 'The deposit whose interest this line receipts' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fixedDepositId?: number | null;

  @ApiPropertyOptional({ enum: EntrySide, description: 'Required on a journal, refused elsewhere' })
  @IsOptional()
  @IsEnum(EntrySide)
  side?: EntrySide | null;
}

class VoucherDto {
  @ApiProperty() id!: number;
  @ApiProperty({ example: 'RV-2026-0125' }) ref!: string;
  @ApiProperty({ enum: VoucherKind }) kind!: VoucherKind;
  @ApiProperty() financialYearId!: number;
  @ApiProperty() date!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ description: 'The document total, summed from its lines' })
  amount!: number;
  @ApiProperty({ type: () => [VoucherLineDto], description: 'The heads this voucher is coded to' })
  lines!: VoucherLineDto[];
  @ApiProperty({ nullable: true, description: 'Who the entry was with' })
  partyId!: number | null;
  @ApiProperty({ enum: PaymentMode, nullable: true, description: 'Null for a journal' })
  mode!: PaymentMode | null;
  @ApiProperty({ nullable: true }) bankAccountId!: number | null;
  @ApiProperty({ nullable: true }) chequeNo!: string | null;
  @ApiProperty({ description: 'Payer for a receipt, payee for a payment' }) party!: string;
  @ApiProperty({ enum: VoucherStatusWire.values }) status!: WireVoucherStatus;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: VoucherActorDto }) createdBy!: VoucherActorDto;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true }) submittedAt!: Date | null;
  @ApiProperty({ type: VoucherActorDto, nullable: true }) decidedBy!: VoucherActorDto | null;
  @ApiProperty({ nullable: true }) decidedAt!: Date | null;
  @ApiProperty({ nullable: true }) rejectionReason!: string | null;
  @ApiProperty({ nullable: true }) postedAt!: Date | null;
}

export class VoucherRecordDto extends VoucherDto {
  @ApiProperty({ type: BankAccountRefDto, nullable: true }) bankAccount!: BankAccountRefDto | null;
}

export class CreateVoucherDto {
  @ApiProperty({ enum: VoucherKind })
  @IsEnum(VoucherKind)
  kind!: VoucherKind;

  @ApiProperty({ example: '2026-05-14' })
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiProperty({
    type: [WriteVoucherLineDto],
    description: 'The heads this voucher is coded to. At least one; the total is their sum',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'A voucher needs at least one head' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WriteVoucherLineDto)
  lines!: WriteVoucherLineDto[];

  @ApiPropertyOptional({
    description: 'Who the entry was with. The typed `party` name is kept alongside it',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partyId?: number;

  @ApiPropertyOptional({
    enum: PaymentMode,
    description:
      'Decides the cash or bank side of the entry; on a contra, the side the money left. Required on every kind but a journal',
  })
  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;

  @ApiPropertyOptional({ description: 'Required for every mode except cash' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bankAccountId?: number;

  @ApiPropertyOptional({ description: 'Required when the mode is cheque' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  chequeNo?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  party!: string;

  @ApiProperty({
    description:
      'The number on the temple’s physical voucher book. Required, so every entry in the system can be matched against the paper it was written on.',
  })
  @IsString()
  @IsNotEmpty({ message: 'The manual voucher number is required' })
  @MaxLength(60)
  manualVoucherNo!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateVoucherDto extends CreateVoucherDto {}

export class RejectVoucherDto {
  @ApiProperty({ description: 'A rejection must say why' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class QueryVouchersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VoucherKind })
  @IsOptional()
  @IsEnum(VoucherKind)
  kind?: VoucherKind;

  @ApiPropertyOptional({ enum: VoucherStatusWire.values })
  @IsOptional()
  @IsIn(VoucherStatusWire.values)
  status?: WireVoucherStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  financialYearId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fundId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accountId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Only vouchers you raised yourself' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  mineOnly?: boolean;
}
