import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_REGEX_MESSAGE } from '../../../common/constants/password.constant';

export class UpdatePasswordDto {
  @ApiProperty({ description: 'Reset token from the AUTH-PRO reset-password email link' })
  @IsString()
  token: string;

  @ApiProperty({
    example: 'N3w!StrongPass',
    description: PASSWORD_REGEX_MESSAGE,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_REGEX_MESSAGE })
  newPassword: string;
}
