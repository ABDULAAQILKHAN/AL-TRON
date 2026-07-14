import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MemorySearchResultDto {
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

  @ApiProperty({
    description: 'Atlas Vector Search relevance score (cosine similarity, higher is closer)',
  })
  score: number;
}
