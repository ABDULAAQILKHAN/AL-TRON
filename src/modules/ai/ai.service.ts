import { Injectable } from '@nestjs/common';
import { AiRequestStatus } from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptDto } from './dto/prompt.dto';

@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Placeholder for the real model call (OpenAI/Anthropic/etc). Every prompt is logged
   * so the strict "ai" throttler tier has an audit trail to back it up — wire your
   * model provider client in here.
   */
  async runPrompt(user: AuthUser, dto: PromptDto) {
    const log = await this.prisma.aiRequestLog.create({
      data: {
        userId: user.id,
        model: dto.model ?? 'default',
        status: AiRequestStatus.PENDING,
      },
    });

    try {
      const completion = `TODO: wire an AI provider — echoing prompt: ${dto.prompt}`;

      await this.prisma.aiRequestLog.update({
        where: { id: log.id },
        data: { status: AiRequestStatus.SUCCEEDED },
      });

      return { requestId: log.id, completion };
    } catch (error) {
      await this.prisma.aiRequestLog.update({
        where: { id: log.id },
        data: { status: AiRequestStatus.FAILED, errorMessage: (error as Error).message },
      });
      throw error;
    }
  }
}
