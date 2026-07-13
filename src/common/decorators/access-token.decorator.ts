import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../interfaces/auth-user.interface';

/** The raw bearer token AuthProGuard verified, for handlers that need to proxy it onward to AUTH-PRO. */
export const AccessToken = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.accessToken;
});
