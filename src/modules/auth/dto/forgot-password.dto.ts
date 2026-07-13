import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsUrl } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'https://app.example.com/reset-password' })
  @IsUrl({ require_tld: false })
  redirectUrl: string;
}
