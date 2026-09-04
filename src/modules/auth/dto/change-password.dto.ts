import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../common/password';

export class ChangePasswordDto {
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    description: 'Must differ from the current password',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
