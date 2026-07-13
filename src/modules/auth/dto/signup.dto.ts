import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, IsUrl, Matches } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_REGEX_MESSAGE } from '../../../common/constants/password.constant';

export class SignupDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Str0ng!Pass',
    description: PASSWORD_REGEX_MESSAGE,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_REGEX_MESSAGE })
  password: string;

  @ApiProperty({ example: 'https://app.example.com/welcome' })
  @IsUrl({ require_tld: false })
  redirectUrl: string;

  @ApiPropertyOptional({ example: { plan: 'free' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
