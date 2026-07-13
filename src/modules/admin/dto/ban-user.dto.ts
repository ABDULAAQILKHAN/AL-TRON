import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class BanUserDto {
  @ApiProperty({ description: 'Must match AUTH-PRO\'s ADMIN_PASS env var' })
  @IsString()
  adminPass: string;

  @ApiProperty()
  @IsString()
  userId: string;
}
