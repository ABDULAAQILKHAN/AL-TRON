import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRequestStatus } from '@prisma/client';
import { catchError, firstValueFrom } from 'rxjs';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeUpstreamError } from '../../utils/error-handler.util';
import { ChatMessageDto, ChatRole } from './dto/chat-message.dto';
import { PromptDto } from './dto/prompt.dto';

interface ChatCompletionResponse {
  choices: { message: { role: string; content: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

@Injectable()
export class AiService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultModel: string;
  private readonly timeout: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('githubModels.baseUrl') as string;
    this.token = this.configService.get<string>('githubModels.token') as string;
    this.defaultModel = this.configService.get<string>('githubModels.defaultModel') as string;
    this.timeout = this.configService.get<number>('githubModels.timeoutMs') as number;
  }

  async runPrompt(user: AuthUser, dto: PromptDto) {
    const model = dto.model ?? this.defaultModel;

    const log = await this.prisma.aiRequestLog.create({
      data: {
        userId: user.id,
        model,
        status: AiRequestStatus.PENDING,
      },
    });

    try {
      const messages = [...(dto.history ?? []), { role: ChatRole.USER, content: dto.prompt }];
      const { completion, promptTokens, completionTokens } = await this.chatCompletion(model, messages);

      await this.prisma.aiRequestLog.update({
        where: { id: log.id },
        data: { status: AiRequestStatus.SUCCEEDED, promptTokens, completionTokens },
      });

      return { requestId: log.id, completion, model, promptTokens, completionTokens };
    } catch (error) {
      await this.prisma.aiRequestLog.update({
        where: { id: log.id },
        data: { status: AiRequestStatus.FAILED, errorMessage: (error as Error).message },
      });
      throw error;
    }
  }

  private async chatCompletion(
    model: string,
    messages: Pick<ChatMessageDto, 'role' | 'content'>[],
  ): Promise<{ completion: string; promptTokens: number; completionTokens: number }> {
    const { data } = await firstValueFrom(
      this.httpService
        .post<ChatCompletionResponse>(
          `${this.baseUrl}/chat/completions`,
          { model, messages },
          {
            timeout: this.timeout,
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
          },
        )
        .pipe(
          catchError((error) => {
            throw normalizeUpstreamError(error, 'GitHub Models');
          }),
        ),
    );

    return {
      completion: data.choices[0]?.message?.content ?? '',
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
