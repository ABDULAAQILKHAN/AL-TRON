import { Request } from 'express';

/** Shape returned by AUTH-PRO's GET /users/me, attached to the request by AuthProGuard. */
export interface AuthUser {
  id: string;
  email: string;
  avatarUrl: string | null;
  metadata: Record<string, unknown>;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Request augmented with the authenticated user + the raw bearer token, for downstream proxying. */
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  accessToken: string;
}
