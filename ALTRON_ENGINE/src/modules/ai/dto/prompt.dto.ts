import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class PromptDto {
  @ApiProperty({ example: 'Summarize the latest deploy logs.', maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  prompt: string;
}
