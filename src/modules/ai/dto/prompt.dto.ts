import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ChatMessageDto } from './chat-message.dto';

export class PromptDto {
  @ApiProperty({ example: 'Summarize the latest deploy logs.', maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  prompt: string;

  @ApiPropertyOptional({ example: 'openai/gpt-4o-mini', description: 'GitHub Models catalog id; falls back to the configured default' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    type: [ChatMessageDto],
    description: 'Prior conversation turns, sent before `prompt` to give the model multi-turn context',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}
