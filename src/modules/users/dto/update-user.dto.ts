import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: { theme: 'dark' },
    description: 'Deep-merged into the existing metadata object by AUTH-PRO',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
