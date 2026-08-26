import { ApiProperty } from '@nestjs/swagger';

import { UserRole } from '../../../generated/prisma/enums';

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() nameTa!: string;
  @ApiProperty({ nullable: true }) fullName!: string | null;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ isArray: true, type: String }) permissions!: string[];
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' }) expiresIn!: number;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}
