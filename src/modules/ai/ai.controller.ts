import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopedOkResponse } from '../../common/decorators/api-enveloped-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SWAGGER_BEARER_AUTH_NAME } from '../../config/swagger.config';
import { AiService } from './ai.service';
import { PromptDto } from './dto/prompt.dto';
import { PromptResponseDto } from './dto/prompt-response.dto';

// No @SkipThrottle here: this controller intentionally stays subject to BOTH the
// global "default" tier and the stricter "ai" tier registered in ThrottlerModule,
// so the ai tier's tighter limit is the binding constraint on these routes.
@ApiTags('ai')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('prompt')
  @ApiOperation({ summary: 'Run a prompt through the AI gateway (strict rate limit)' })
  @ApiEnvelopedOkResponse(PromptResponseDto)
  runPrompt(@CurrentUser() user: AuthUser, @Body() dto: PromptDto) {
    return this.aiService.runPrompt(user, dto);
  }
}
