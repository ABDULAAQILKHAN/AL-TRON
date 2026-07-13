import { ApiProperty } from '@nestjs/swagger';

export class PromptResponseDto {
  @ApiProperty({ description: 'AiRequestLog id, for audit/debugging' })
  requestId: string;

  @ApiProperty()
  completion: string;
}
