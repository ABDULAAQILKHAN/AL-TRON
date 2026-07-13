import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as exempt from AuthProGuard (e.g. health checks, auth/signup, auth/login). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
