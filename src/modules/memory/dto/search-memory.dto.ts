import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SearchMemoryDto {
  @ApiProperty({ example: 'What did we decide about the deploy pipeline?', maxLength: 8000 })
  @IsString()
  @MaxLength(8000)
  query: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 50, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 5;
}
