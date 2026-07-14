import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Prisma } from '../../../generated/mongo-client';
import { MongoPrismaService } from '../../prisma/mongo-prisma.service';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { MemoryResponseDto } from './dto/memory-response.dto';
import { MemorySearchResultDto } from './dto/memory-search-result.dto';

interface RawMemoryDocument {
  _id: { $oid: string };
  source: string;
  action: string;
  text_content: string;
  metadata?: Record<string, unknown> | null;
  created_at: { $date: string };
  score: number;
}

interface AggregateRawResponse {
  cursor?: { firstBatch?: RawMemoryDocument[] };
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly openai: OpenAI;
  private readonly embeddingModel: string;
  private readonly vectorSearchIndex: string;

  constructor(
    private readonly mongoPrisma: MongoPrismaService,
    private readonly configService: ConfigService,
  ) {
    // GitHub Models exposes an OpenAI-compatible REST surface (chat + embeddings),
    // so the official `openai` SDK can talk to it directly by pointing baseURL at
    // GitHub Models and reusing the same GITHUB_PAT already configured for AiModule.
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('githubModels.token'),
      baseURL: this.configService.get<string>('githubModels.baseUrl'),
    });
    this.embeddingModel = this.configService.get<string>('githubModels.embeddingModel') as string;
    this.vectorSearchIndex = this.configService.get<string>('memory.vectorSearchIndex') as string;
  }

  async logMemory(dto: CreateMemoryDto): Promise<MemoryResponseDto> {
    const vectorEmbedding = await this.generateEmbedding(dto.textContent);

    const memory = await this.mongoPrisma.memory.create({
      data: {
        source: dto.source,
        action: dto.action,
        textContent: dto.textContent,
        vectorEmbedding,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });

    return {
      id: memory.id,
      source: memory.source,
      action: memory.action,
      textContent: memory.textContent,
      metadata: memory.metadata as Record<string, unknown> | null,
      createdAt: memory.createdAt,
    };
  }

  /**
   * Standard Prisma has no $vectorSearch support for MongoDB, so this drops down to a
   * raw aggregation pipeline via $runCommandRaw. Requires an Atlas Vector Search index
   * (named `this.vectorSearchIndex`) on the `memories` collection's `vector_embedding`
   * field, created out-of-band (Atlas UI/CLI) — Prisma cannot create search indexes.
   */
  async searchSimilarMemories(query: string, limit: number): Promise<MemorySearchResultDto[]> {
    const queryVector = await this.generateEmbedding(query);
    const numCandidates = Math.max(limit * 10, 100);

    const result = (await this.mongoPrisma.$runCommandRaw({
      aggregate: 'memories',
      pipeline: [
        {
          $vectorSearch: {
            index: this.vectorSearchIndex,
            path: 'vector_embedding',
            queryVector,
            numCandidates,
            limit,
          },
        },
        {
          $project: {
            _id: 1,
            source: 1,
            action: 1,
            text_content: 1,
            metadata: 1,
            created_at: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ],
      cursor: {},
    })) as AggregateRawResponse;

    const documents = result.cursor?.firstBatch ?? [];
    return documents.map((doc) => this.mapRawDocument(doc));
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  private mapRawDocument(doc: RawMemoryDocument): MemorySearchResultDto {
    return {
      id: doc._id.$oid,
      source: doc.source,
      action: doc.action,
      textContent: doc.text_content,
      metadata: doc.metadata ?? null,
      createdAt: new Date(doc.created_at.$date),
      score: doc.score,
    };
  }
}
