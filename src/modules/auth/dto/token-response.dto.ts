import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ description: 'AUTH-PRO bearer token to use as `Authorization: Bearer <accessToken>`' })
  accessToken: string;
}
