import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { AuditActionWire, type WireAuditAction } from '../../../common/enums/wire';
import { UserRole } from '../../../generated/prisma/enums';

export class AuditEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() at!: Date;
  @ApiProperty({ nullable: true, description: 'Null once the actor is deleted; the name survives' })
  actorId!: string | null;
  @ApiProperty() actorName!: string;
  @ApiProperty({ enum: UserRole, description: 'The role held at the time, not today' })
  actorRole!: UserRole;
  @ApiProperty({ enum: AuditActionWire.values }) action!: WireAuditAction;
  @ApiProperty() entity!: string;
  @ApiProperty({ nullable: true }) entityRef!: string | null;
  @ApiProperty() summary!: string;
  @ApiProperty() ipAddress!: string;
  @ApiProperty({ nullable: true, description: 'Field-level changes, where the action had any' })
  diff!: unknown;
}

export class QueryAuditDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditActionWire.values })
  @IsOptional()
  @IsIn(AuditActionWire.values)
  action?: WireAuditAction;

  @ApiPropertyOptional({ example: 'voucher' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
