import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class SendCustomMailDto {
  @ApiProperty({ description: 'Must match AUTH-PRO\'s ADMIN_PASS env var' })
  @IsString()
  adminPass: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  to: string;

  @ApiProperty({ example: 'Your account update' })
  @IsString()
  subject: string;

  @ApiProperty({ example: '<p>Hello {{name}}</p>' })
  @IsString()
  htmlTemplate: string;
}
