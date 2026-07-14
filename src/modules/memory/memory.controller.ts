import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopedOkResponse } from '../../common/decorators/api-enveloped-response.decorator';
import { SWAGGER_BEARER_AUTH_NAME } from '../../config/swagger.config';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { MemoryResponseDto } from './dto/memory-response.dto';
import { MemorySearchResultDto } from './dto/memory-search-result.dto';
import { SearchMemoryDto } from './dto/search-memory.dto';
import { MemoryService } from './memory.service';

@ApiTags('memory')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Post('log')
  @ApiOperation({
    summary: 'Embed and persist a memory (agent action/observation) for later RAG retrieval',
  })
  @ApiEnvelopedOkResponse(MemoryResponseDto)
  logMemory(@Body() dto: CreateMemoryDto): Promise<MemoryResponseDto> {
    return this.memoryService.logMemory(dto);
  }

  @Post('search')
  @ApiOperation({ summary: 'Find memories most similar to a query via Atlas Vector Search' })
  @ApiEnvelopedOkResponse(MemorySearchResultDto)
  searchMemories(@Body() dto: SearchMemoryDto): Promise<MemorySearchResultDto[]> {
    return this.memoryService.searchSimilarMemories(dto.query, dto.limit ?? 5);
  }
}
