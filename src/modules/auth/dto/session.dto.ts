import { ApiProperty } from '@nestjs/swagger';

export class SessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() deviceName!: string;
  @ApiProperty() ipAddress!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ description: 'True for the session making this request' }) current!: boolean;
}
