import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PromptDto {
  @ApiProperty({ example: 'Summarize the latest deploy logs.', maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  prompt: string;

  @ApiPropertyOptional({ example: 'gpt-4o' })
  @IsOptional()
  @IsString()
  model?: string;
}
