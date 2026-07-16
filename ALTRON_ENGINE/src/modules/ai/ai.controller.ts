import { Body, Controller, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiEnvelopedOkResponse } from '../../common/decorators/api-enveloped-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SWAGGER_BEARER_AUTH_NAME } from '../../config/swagger.config';
import { AiService, PromptStatusStage } from './ai.service';
import { PromptDto } from './dto/prompt.dto';
import { PromptResponseDto } from './dto/prompt-response.dto';

/** Every event shape `/ai/prompt/stream` can write, one JSON object per SSE `data:` line. */
type PromptStreamEvent =
  | { type: 'status'; stage: PromptStatusStage | 'thinking' }
  | { type: 'result'; payload: PromptResponseDto }
  | { type: 'error'; message: string };

// No @SkipThrottle here: this controller intentionally stays subject to BOTH the
// global "default" tier and the stricter "ai" tier registered in ThrottlerModule,
// so the ai tier's tighter limit is the binding constraint on these routes.
@ApiTags('ai')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('prompt')
  @ApiOperation({
    summary:
      'Run a prompt through the Router + Specialist AI gateway (strict rate limit). ' +
      'A lightweight router model decides whether historical memory is needed; if so, a heavier ' +
      'specialist model answers using the retrieved context, otherwise the router reply is returned directly.',
  })
  @ApiEnvelopedOkResponse(PromptResponseDto)
  runPrompt(@CurrentUser() user: AuthUser, @Body() dto: PromptDto) {
    return this.aiService.runPrompt(user, dto);
  }

  /**
   * SSE variant of `/ai/prompt`. Emits interim `status` events (thinking ->
   * remembering/saving, depending on which branch the router takes) before
   * the final `result` event, so a client can play stage-aware spoken filler
   * in the same synthesized voice while the pipeline is still running instead
   * of sitting in silence. `@Sse()` hardcodes GET, which can't carry a JSON
   * body, so this streams by hand over a raw `@Res()` instead - the request
   * itself is still a normal POST, only the response is chunked.
   */
  @Post('prompt/stream')
  @ApiOperation({
    summary:
      'SSE variant of /ai/prompt: streams interim status events (thinking/remembering/saving) ' +
      "ahead of the final result event, so clients can narrate progress in AL-TRON's voice.",
  })
  @ApiExcludeEndpoint()
  async runPromptStream(
    @CurrentUser() user: AuthUser,
    @Body() dto: PromptDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const writeEvent = (event: PromptStreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    writeEvent({ type: 'status', stage: 'thinking' });

    try {
      const payload = await this.aiService.runPrompt(user, dto, (stage) => {
        writeEvent({ type: 'status', stage });
      });
      writeEvent({ type: 'result', payload });
    } catch (error) {
      writeEvent({ type: 'error', message: (error as Error).message });
    } finally {
      res.end();
    }
  }
}
