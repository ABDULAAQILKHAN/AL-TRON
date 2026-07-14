import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMemoryDto {
  @ApiProperty({
    example: 'ai-agent',
    description: 'What produced this memory (agent name, service, user, ...)',
  })
  @IsString()
  @MaxLength(200)
  source: string;

  @ApiProperty({ example: 'tool_call', description: 'What kind of event this memory records' })
  @IsString()
  @MaxLength(200)
  action: string;

  @ApiProperty({ example: 'User asked to summarize the Q3 deploy logs.', maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  textContent: string;

  @ApiPropertyOptional({ example: { conversationId: 'abc-123' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
