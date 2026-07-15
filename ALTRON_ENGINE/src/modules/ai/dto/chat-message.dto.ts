import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';

export enum ChatRole {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
}

/** One turn of prior conversation context, sent before the current `prompt`. */
export class ChatMessageDto {
  @ApiProperty({ enum: ChatRole, example: ChatRole.USER })
  @IsEnum(ChatRole)
  role: ChatRole;

  @ApiProperty({ maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  content: string;
}
