import { ApiProperty } from '@nestjs/swagger';

import { AccountRole } from '../../../generated/prisma/enums';

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'The name on the party this sign-in belongs to' })
  nameTa!: string;
  @ApiProperty({ nullable: true }) nameEn!: string | null;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: AccountRole }) role!: AccountRole;
  @ApiProperty({ isArray: true, type: String }) permissions!: string[];
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' }) expiresIn!: number;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}
