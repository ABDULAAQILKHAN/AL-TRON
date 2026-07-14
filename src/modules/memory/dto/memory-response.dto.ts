import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Deliberately omits `vectorEmbedding` — it's an internal implementation detail, not API surface. */
export class MemoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  source: string;

  @ApiProperty()
  action: string;

  @ApiProperty()
  textContent: string;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;
}
