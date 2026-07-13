import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, AuthUser } from '../interfaces/auth-user.interface';

/** Pulls the AUTH-PRO user attached by AuthProGuard onto the handler param, e.g. `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user;
});
