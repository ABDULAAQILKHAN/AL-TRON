import * as fs from 'fs';
import * as path from 'path';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRequestStatus } from '@prisma/client';
import { catchError, firstValueFrom } from 'rxjs';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { MemorySearchResultDto } from '../memory/dto/memory-search-result.dto';
import { MemoryService } from '../memory/memory.service';
import { CreateMemoryDto } from '../memory/dto/create-memory.dto';
import { PersonaChatMessage, PersonaContext, PersonaService } from '../persona/persona.service';
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

const SAVE_MEMORY_TOOL_NAME = 'save_memory';

/** Fixed `source` for anything written via this tool - distinguishes conversational writes from other ingestion pipelines (job scraper, smart home, news scraper, ...). */
const CONVERSATIONAL_MEMORY_SOURCE = 'ai-conversation';

const SAVE_MEMORY_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: SAVE_MEMORY_TOOL_NAME,
    description:
      "Saves a new entry to AL-TRON's historical memory log for later retrieval. Call this when the user " +
      'explicitly asks you to remember, record, save, log, or note something for future reference.',
    parameters: {
      type: 'object',
      properties: {
        textContent: {
          type: 'string',
          description:
            'The exact fact, event, or note to remember, written as a clear standalone statement.',
        },
        action: {
          type: 'string',
          description:
            'A short category/label for this memory, e.g. "job_application", "reminder", "preference", "event".',
        },
      },
      required: ['textContent', 'action'],
    },
  },
};

const ROUTER_SYSTEM_PROMPT =
  "You are AL-TRON's front desk. You have two tools available:\n\n" +
  `- \`${QUERY_HISTORICAL_MEMORY_TOOL_NAME}\`: call this when the user's message requires AL-TRON's ` +
  "private historical memory log (the user's own past actions, jobs applied to, smart home events, news " +
  'scraped, or other personally logged context) to answer.\n' +
  `- \`${SAVE_MEMORY_TOOL_NAME}\`: call this when the user explicitly asks you to remember, record, save, ` +
  'log, or note something for later - not when they are merely asking a question.\n\n' +
  'If neither applies - general knowledge, definitions, small talk, math, or anything else that does not ' +
  'require personal logs (e.g. "what is the sun", "what is 2+2", "write a poem") - reply directly WITHOUT ' +
  'calling any tool.\n\n' +
  'Do not call a tool speculatively "just in case" — only call one when it is actually required.';

const SPECIALIST_SYSTEM_PROMPT =
  "You are AL-TRON, the user's personal AI assistant. You have been handed the user's original request " +
  "plus historical context retrieved from AL-TRON's memory log. Answer using that context where it is " +
  'relevant, and say so plainly if the context does not contain the answer rather than guessing.';

// nest-cli.json has "assets": [] (nothing gets copied into dist/ on build), so this is
// resolved against the project root rather than __dirname - works identically whether
// the process was started via `nest start` or `node dist/main`, since `src/` stays on
// disk alongside `dist/` either way.
const ALTRON_PROFILE_PATH = path.join(process.cwd(), 'src', 'information', 'altron_profile.json');

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly routerModel: string;
  private readonly specialistModel: string;
  private readonly timeout: number;
  /** AL-TRON's persona + user-profile system message, built once at startup. */
  private readonly personaSystemPrompt: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly memoryService: MemoryService,
    private readonly personaService: PersonaService,
  ) {
    this.baseUrl = this.configService.get<string>('githubModels.baseUrl') as string;
    this.token = this.configService.get<string>('githubModels.token') as string;
    this.routerModel = this.configService.get<string>('githubModels.routerModel') as string;
    this.specialistModel = this.configService.get<string>('githubModels.specialistModel') as string;
    this.timeout = this.configService.get<number>('githubModels.timeoutMs') as number;
    this.personaSystemPrompt = this.buildPersonaSystemPrompt(this.loadAltronProfile());
  }

  /** Reads the local profile config; falls back to an empty object if it's missing or malformed. */
  private loadAltronProfile(): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(ALTRON_PROFILE_PATH, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `Could not load altron_profile.json at ${ALTRON_PROFILE_PATH} (${(error as Error).message}) - continuing with an empty profile`,
      );
      return {};
    }
  }

  private buildPersonaSystemPrompt(profileData: Record<string, unknown>): string {
    return `You are AL-TRON, an advanced, elite, and highly contextual AI assistant. You are not a generic chatbot.

Here is the immutable profile of the user you are interacting with:
${JSON.stringify(profileData, null, 2)}

Behavioral Directives:
- Identity: You know you are AL-TRON. Own it.
- Tone: Match the user's register. Be incredibly sharp, direct, concise, and professional, but weave in a calculated, witty, and slightly savage edge. Do not use conversational filler or patronizing opening phrases like "Sure thing!" or "Great question!". Cut straight to the value.
- Core Directives: Adhere strictly to the "strictCodingRules" defined in the user profile (e.g., focus on fixing bugs rather than rewriting frameworks, always use the required div wrappers for sorting utilities).`;
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
      // Phase 2: pull short-term session state (recent turns + any greeting/mood
      // directive for this message) from Redis via PersonaService, layered on top
      // of the long-term identity in `this.personaSystemPrompt`.
      const personaContext = await this.personaService.buildContext(user.id);
      const sessionHistory = this.toChatCompletionMessages(personaContext.history);

      const routerMessages: ChatCompletionMessage[] = [
        { role: ChatRole.SYSTEM, content: this.personaSystemPrompt },
        { role: ChatRole.SYSTEM, content: ROUTER_SYSTEM_PROMPT },
        ...(personaContext.systemPromptFragment
          ? [{ role: ChatRole.SYSTEM, content: personaContext.systemPromptFragment }]
          : []),
        ...sessionHistory,
        { role: ChatRole.USER, content: dto.prompt },
      ];

      this.logger.log(
        `[AI-ROUTER][${log.id}] >> calling router model "${routerModel}" for prompt: "${dto.prompt}" (${sessionHistory.length} prior turns)`,
      );
      const routerResult = await this.chatCompletion(routerModel, routerMessages, [
        QUERY_HISTORICAL_MEMORY_TOOL,
        SAVE_MEMORY_TOOL,
      ]);
      this.logger.debug(
        `[AI-ROUTER][${log.id}] raw router message: ${JSON.stringify(routerResult.message)}`,
      );

      const toolCalls = routerResult.message.tool_calls ?? [];
      const saveMemoryCall = toolCalls.find((call) => call.function.name === SAVE_MEMORY_TOOL_NAME);
      const queryMemoryCall = toolCalls.find(
        (call) => call.function.name === QUERY_HISTORICAL_MEMORY_TOOL_NAME,
      );

      if (saveMemoryCall) {
        this.logger.log(
          `[AI-ROUTER][${log.id}] << decision=SAVE_MEMORY args=${saveMemoryCall.function.arguments}`,
        );
        return await this.finalizeTurn(
          user.id,
          dto.prompt,
          await this.handleSaveMemory(log.id, routerModel, routerResult, saveMemoryCall),
        );
      }

      if (queryMemoryCall) {
        this.logger.log(
          `[AI-ROUTER][${log.id}] << decision=TOOL_CALL args=${queryMemoryCall.function.arguments} -> handing off to specialist "${this.specialistModel}"`,
        );
        return await this.finalizeTurn(
          user.id,
          dto.prompt,
          await this.handleToolInvocation(
            log.id,
            dto.prompt,
            routerResult,
            queryMemoryCall,
            personaContext,
          ),
        );
      }

      this.logger.log(
        `[AI-ROUTER][${log.id}] << decision=DIRECT_REPLY (no tool call) model=${routerModel}`,
      );
      return await this.finalizeTurn(
        user.id,
        dto.prompt,
        await this.handleDirectReply(log.id, routerModel, routerResult),
      );
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

  /** Scenario C: router asked to remember something — embed + persist it, then acknowledge directly. */
  private async handleSaveMemory(
    requestId: string,
    routerModel: string,
    routerResult: ChatCompletionResult,
    toolCall: OpenAiToolCall,
  ) {
    let textContent: string;
    let action: string;
    try {
      const args = JSON.parse(toolCall.function.arguments) as {
        textContent?: string;
        action?: string;
      };
      if (!args.textContent || !args.action) {
        throw new Error('missing textContent or action field');
      }
      textContent = args.textContent;
      action = args.action;
    } catch (parseError) {
      this.logger.error(
        `[${requestId}] Failed to parse tool arguments "${toolCall.function.arguments}": ${(parseError as Error).message}`,
      );
      throw new Error('Router returned malformed save_memory arguments');
    }

    const dto: CreateMemoryDto = {
      source: CONVERSATIONAL_MEMORY_SOURCE,
      action,
      textContent,
    };
    const saved = await this.memoryService.logMemory(dto);

    this.logger.log(
      `[${requestId}] Router invoked ${SAVE_MEMORY_TOOL_NAME} -> saved memory ${saved.id} (action="${action}")`,
    );

    const completion = `Noted. Saved to memory: "${textContent}"`;

    await this.prisma.aiRequestLog.update({
      where: { id: requestId },
      data: {
        status: AiRequestStatus.SUCCEEDED,
        model: routerModel,
        promptTokens: routerResult.promptTokens,
        completionTokens: routerResult.completionTokens,
      },
    });

    return {
      requestId,
      completion,
      model: routerModel,
      promptTokens: routerResult.promptTokens,
      completionTokens: routerResult.completionTokens,
      routed: false,
      memorySaved: true,
      memoryId: saved.id,
    };
  }

  /** Scenario A: router asked for historical context — search memory, then hand off to the specialist. */
  private async handleToolInvocation(
    requestId: string,
    originalPrompt: string,
    routerResult: ChatCompletionResult,
    toolCall: OpenAiToolCall,
    personaContext: PersonaContext,
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
      { role: ChatRole.SYSTEM, content: this.personaSystemPrompt },
      { role: ChatRole.SYSTEM, content: SPECIALIST_SYSTEM_PROMPT },
      ...(personaContext.systemPromptFragment
        ? [{ role: ChatRole.SYSTEM, content: personaContext.systemPromptFragment }]
        : []),
      ...this.toChatCompletionMessages(personaContext.history),
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

  private toChatCompletionMessages(history: PersonaChatMessage[]): ChatCompletionMessage[] {
    return history.map((turn) => ({
      role: turn.role === 'user' ? ChatRole.USER : ChatRole.ASSISTANT,
      content: turn.content,
    }));
  }

  /** Records this turn in the session's rolling history, then passes the result through unchanged. */
  private async finalizeTurn<T extends { completion: string }>(
    userId: string,
    prompt: string,
    result: T,
  ): Promise<T> {
    await this.personaService.recordTurn(userId, prompt, result.completion);
    return result;
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
