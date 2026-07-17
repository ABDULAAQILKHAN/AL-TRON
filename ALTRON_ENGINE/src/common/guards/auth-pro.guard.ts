import { HttpService } from '@nestjs/axios';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AxiosError } from 'axios';
import { catchError, firstValueFrom } from 'rxjs';
import { UsersService } from '../../modules/users/users.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest, AuthUser } from '../interfaces/auth-user.interface';

/**
 * Validates the incoming `Authorization: Bearer <token>` header by delegating to
 * AUTH-PRO's GET /users/me. AL-TRON never verifies the JWT itself — it has no
 * shared secret with AUTH-PRO — so a valid session is defined as "AUTH-PRO
 * accepted this token just now". The resolved user + raw token are attached to
 * the request for handlers/decorators (@CurrentUser, @AccessToken) to consume.
 */
@Injectable()
export class AuthProGuard implements CanActivate {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const user = await this.verifyWithAuthPro(token);
    // Guarantees the local shadow row exists before ANY guarded endpoint runs
    // - not just /users/*. Without this, a client that logs in and goes
    // straight to e.g. /ai/prompt (skipping /users/me entirely) hits a
    // foreign-key violation on AiRequestLog.userId for a row that was never
    // created.
    await this.usersService.upsertShadow(user);

    request.user = user;
    request.accessToken = token;
    return true;
  }

  private extractBearerToken(request: AuthenticatedRequest): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;

    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }

  private async verifyWithAuthPro(token: string): Promise<AuthUser> {
    const baseUrl = this.configService.get<string>('authPro.baseUrl');
    const timeout = this.configService.get<number>('authPro.timeoutMs');

    const { data } = await firstValueFrom(
      this.httpService
        .get<AuthUser>(`${baseUrl}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout,
        })
        .pipe(
          catchError((error: AxiosError) => {
            if (error.response?.status === 401 || error.response?.status === 403) {
              throw new UnauthorizedException('Invalid or expired session');
            }
            throw new UnauthorizedException('Unable to verify session with AUTH-PRO');
          }),
        ),
    );

    return data;
  }
}
