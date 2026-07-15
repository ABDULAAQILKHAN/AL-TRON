import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PromptResponseDto {
  @ApiProperty({ description: 'AiRequestLog id, for audit/debugging' })
  requestId: string;

  @ApiProperty()
  completion: string;

  @ApiProperty({ description: 'Model that produced `completion` (router or specialist)' })
  model: string;

  @ApiProperty()
  promptTokens: number;

  @ApiProperty()
  completionTokens: number;

  @ApiProperty({
    description:
      'True if the router invoked query_historical_memory and the specialist model answered',
  })
  routed: boolean;

  @ApiPropertyOptional({
    description: 'Number of memories retrieved and handed to the specialist, when routed',
  })
  memoriesUsed?: number;
}
