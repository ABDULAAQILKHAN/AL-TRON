import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Two named tiers:
 *  - "default": general API traffic limit, applied globally.
 *  - "ai": stricter limit layered on top of "default" for AI/automation
 *    endpoints, applied explicitly via @Throttle({ ai: {...} }) or the
 *    default() below matched by name in those controllers.
 */
export const throttlerConfigFactory = (config: ConfigService): ThrottlerModuleOptions => ({
  throttlers: [
    {
      name: 'default',
      ttl: config.get<number>('throttle.default.ttl') as number,
      limit: config.get<number>('throttle.default.limit') as number,
    },
    {
      name: 'ai',
      ttl: config.get<number>('throttle.ai.ttl') as number,
      limit: config.get<number>('throttle.ai.limit') as number,
    },
  ],
});
