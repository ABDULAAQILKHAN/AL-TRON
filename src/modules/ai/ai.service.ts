import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRequestStatus } from '@prisma/client';
import { catchError, firstValueFrom } from 'rxjs';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { MemorySearchResultDto } from '../memory/dto/memory-search-result.dto';
import { MemoryService } from '../memory/memory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeUpstreamError } from '../../utils/error-handler.util';
import { ChatMessageDto, ChatRole } from './dto/chat-message.dto';
import { PromptDto } from './dto/prompt.dto';

type ChatCompletionMessage = Pick<ChatMessageDto, 'role' | 'content'>;

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** Raw JSON string per the OpenAI function-calling contract; must be JSON.parse'd. */
    arguments: string;
  };
}

interface OpenAiResponseMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}

interface ChatCompletionResponse {
  choices: { message: OpenAiResponseMessage }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

interface ChatCompletionResult {
  message: OpenAiResponseMessage;
  promptTokens: number;
  completionTokens: number;
}

const QUERY_HISTORICAL_MEMORY_TOOL_NAME = 'query_historical_memory';

/** How many past memories the specialist gets when the router decides history is relevant. */
const MEMORY_SEARCH_LIMIT = 5;

const QUERY_HISTORICAL_MEMORY_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: QUERY_HISTORICAL_MEMORY_TOOL_NAME,
    description:
      "Searches AL-TRON's historical memory log (past actions, jobs applied to, smart home events, " +
      'scraped news, and other logged context) for entries relevant to a natural-language query.',
    parameters: {
      type: 'object',
      properties: {
        searchQuery: {
          type: 'string',
          description:
            'A concise natural-language query describing what historical context to retrieve.',
        },
      },
      required: ['searchQuery'],
    },
  },
};

const ROUTER_SYSTEM_PROMPT =
  "You are AL-TRON's front desk. Decide whether the user's message requires AL-TRON's private historical " +
  "memory log (the user's own past actions, jobs applied to, smart home events, news scraped, or other " +
  'personally logged context).\n\n' +
  `- If it genuinely needs that personal history, call \`${QUERY_HISTORICAL_MEMORY_TOOL_NAME}\` with a concise search query.\n` +
  '- If it is general knowledge, definitions, small talk, math, or anything else that does not require ' +
  'personal logs (e.g. "what is the sun", "what is 2+2", "write a poem"), reply directly WITHOUT calling ' +
  'any tool.\n\n' +
  'Do not call the tool speculatively "just in case" — only call it when personal historical context is ' +
  'actually required to answer.';

const SPECIALIST_SYSTEM_PROMPT =
  "You are AL-TRON, the user's personal AI assistant. You have been handed the user's original request " +
  "plus historical context retrieved from AL-TRON's memory log. Answer using that context where it is " +
  'relevant, and say so plainly if the context does not contain the answer rather than guessing.';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly routerModel: string;
  private readonly specialistModel: string;
  private readonly timeout: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
  ) {
    this.baseUrl = this.configService.get<string>('githubModels.baseUrl') as string;
    this.token = this.configService.get<string>('githubModels.token') as string;
    this.routerModel = this.configService.get<string>('githubModels.routerModel') as string;
    this.specialistModel = this.configService.get<string>('githubModels.specialistModel') as string;
    this.timeout = this.configService.get<number>('githubModels.timeoutMs') as number;
  }

  /**
   * Two-step "Router + Specialist" pipeline:
   *  1. `routerModel` (gpt-4o-mini) sees the prompt with a single tool, `query_historical_memory`.
   *  2. If it calls the tool, we run the memory search ourselves and hand the original prompt plus
   *     the retrieved context to `specialistModel` (gpt-4o) for the real answer.
   *     Otherwise the router's own reply is returned as-is to save latency and tokens.
   */
  async runPrompt(user: AuthUser, dto: PromptDto) {
    const routerModel = this.routerModel;

    const log = await this.prisma.aiRequestLog.create({
      data: {
        userId: user.id,
        model: routerModel,
        status: AiRequestStatus.PENDING,
      },
    });

    try {
      const routerMessages: ChatCompletionMessage[] = [
        { role: ChatRole.SYSTEM, content: ROUTER_SYSTEM_PROMPT },
        { role: ChatRole.USER, content: dto.prompt },
      ];

      this.logger.log(
        `[AI-ROUTER][${log.id}] >> calling router model "${routerModel}" for prompt: "${dto.prompt}"`,
      );
      const routerResult = await this.chatCompletion(routerModel, routerMessages, [
        QUERY_HISTORICAL_MEMORY_TOOL,
      ]);
      this.logger.debug(
        `[AI-ROUTER][${log.id}] raw router message: ${JSON.stringify(routerResult.message)}`,
      );

      const toolCall = routerResult.message.tool_calls?.find(
        (call) => call.function.name === QUERY_HISTORICAL_MEMORY_TOOL_NAME,
      );

      if (!toolCall) {
        this.logger.log(
          `[AI-ROUTER][${log.id}] << decision=DIRECT_REPLY (no tool call) model=${routerModel}`,
        );
        return await this.handleDirectReply(log.id, routerModel, routerResult);
      }

      this.logger.log(
        `[AI-ROUTER][${log.id}] << decision=TOOL_CALL args=${toolCall.function.arguments} -> handing off to specialist "${this.specialistModel}"`,
      );
      return await this.handleToolInvocation(log.id, dto.prompt, routerResult, toolCall);
    } catch (error) {
      this.logger.error(
        `[${log.id}] Prompt routing pipeline failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.prisma.aiRequestLog.update({
        where: { id: log.id },
        data: { status: AiRequestStatus.FAILED, errorMessage: (error as Error).message },
      });
      throw error;
    }
  }

  /** Scenario B: router answered without invoking the tool — return its reply as-is. */
  private async handleDirectReply(
    requestId: string,
    routerModel: string,
    routerResult: ChatCompletionResult,
  ) {
    await this.prisma.aiRequestLog.update({
      where: { id: requestId },
      data: {
        status: AiRequestStatus.SUCCEEDED,
        model: routerModel,
        promptTokens: routerResult.promptTokens,
        completionTokens: routerResult.completionTokens,
      },
    });

    this.logger.log(`[${requestId}] Router answered directly, no memory lookup required`);

    return {
      requestId,
      completion: routerResult.message.content ?? '',
      model: routerModel,
      promptTokens: routerResult.promptTokens,
      completionTokens: routerResult.completionTokens,
      routed: false,
    };
  }

  /** Scenario A: router asked for historical context — search memory, then hand off to the specialist. */
  private async handleToolInvocation(
    requestId: string,
    originalPrompt: string,
    routerResult: ChatCompletionResult,
    toolCall: OpenAiToolCall,
  ) {
    let searchQuery: string;
    try {
      const args = JSON.parse(toolCall.function.arguments) as { searchQuery?: string };
      if (!args.searchQuery) {
        throw new Error('missing searchQuery field');
      }
      searchQuery = args.searchQuery;
    } catch (parseError) {
      this.logger.error(
        `[${requestId}] Failed to parse tool arguments "${toolCall.function.arguments}": ${(parseError as Error).message}`,
      );
      throw new Error('Router returned malformed query_historical_memory arguments');
    }

    this.logger.log(
      `[${requestId}] Router invoked ${QUERY_HISTORICAL_MEMORY_TOOL_NAME} with query="${searchQuery}"`,
    );

    const memories = await this.memoryService.searchSimilarMemories(
      searchQuery,
      MEMORY_SEARCH_LIMIT,
    );
    this.logger.debug(
      `[AI-ROUTER][${requestId}] memory search returned ${memories.length} result(s): ` +
        JSON.stringify(
          memories.map((m) => ({ score: m.score, source: m.source, action: m.action })),
        ),
    );
    const memoryContext = this.formatMemoryContext(memories);

    const specialistMessages: ChatCompletionMessage[] = [
      { role: ChatRole.SYSTEM, content: SPECIALIST_SYSTEM_PROMPT },
      {
        role: ChatRole.USER,
        content: `${originalPrompt}\n\n--- Retrieved Historical Context ---\n${memoryContext}`,
      },
    ];

    const specialistResult = await this.chatCompletion(this.specialistModel, specialistMessages);

    const promptTokens = routerResult.promptTokens + specialistResult.promptTokens;
    const completionTokens = routerResult.completionTokens + specialistResult.completionTokens;

    await this.prisma.aiRequestLog.update({
      where: { id: requestId },
      data: {
        status: AiRequestStatus.SUCCEEDED,
        model: this.specialistModel,
        promptTokens,
        completionTokens,
      },
    });

    this.logger.log(
      `[${requestId}] Specialist (${this.specialistModel}) answered using ${memories.length} retrieved memories`,
    );

    return {
      requestId,
      completion: specialistResult.message.content ?? '',
      model: this.specialistModel,
      promptTokens,
      completionTokens,
      routed: true,
      memoriesUsed: memories.length,
    };
  }

  private formatMemoryContext(memories: MemorySearchResultDto[]): string {
    if (memories.length === 0) {
      return 'No relevant historical memories were found.';
    }

    return memories
      .map((memory, index) => {
        const timestamp = memory.createdAt.toISOString();
        return `${index + 1}. [${memory.source}/${memory.action}] (${timestamp}, relevance ${memory.score.toFixed(3)}): ${memory.textContent}`;
      })
      .join('\n');
  }

  private async chatCompletion(
    model: string,
    messages: ChatCompletionMessage[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletionResult> {
    const payload: Record<string, unknown> = { model, messages };
    if (tools) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    const { data } = await firstValueFrom(
      this.httpService
        .post<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, payload, {
          timeout: this.timeout,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        })
        .pipe(
          catchError((error) => {
            this.logger.error(
              `Chat completion call to ${model} failed: ${(error as Error).message}`,
            );
            throw normalizeUpstreamError(error, 'GitHub Models');
          }),
        ),
    );

    const message = data.choices[0]?.message ?? { role: 'assistant', content: '' };

    return {
      message,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
