import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Mirrors AUTH-PRO's GET /users/me response shape, for Swagger schema generation. */
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ type: Object })
  metadata: Record<string, unknown>;

  @ApiProperty()
  isEmailVerified: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
