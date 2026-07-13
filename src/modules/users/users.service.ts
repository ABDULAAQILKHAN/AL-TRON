import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import { catchError, firstValueFrom } from 'rxjs';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeUpstreamError } from '../../utils/error-handler.util';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = this.configService.get<string>('authPro.baseUrl') as string;
    this.timeout = this.configService.get<number>('authPro.timeoutMs') as number;
  }

  /** AuthProGuard already resolved the caller against AUTH-PRO for this request — no extra round trip needed. */
  async getMe(user: AuthUser): Promise<AuthUser> {
    await this.upsertShadow(user);
    return user;
  }

  async updateMe(token: string, dto: UpdateUserDto): Promise<AuthUser> {
    const { data } = await firstValueFrom(
      this.httpService
        .patch<AuthUser>(`${this.baseUrl}/users/me`, dto, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: this.timeout,
        })
        .pipe(catchError((error) => Promise.reject(normalizeUpstreamError(error, 'AUTH-PRO')))),
    );

    await this.upsertShadow(data);
    return data;
  }

  async uploadAvatar(token: string, file: Express.Multer.File): Promise<AuthUser> {
    const form = new FormData();
    form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });

    const { data } = await firstValueFrom(
      this.httpService
        .post<AuthUser>(`${this.baseUrl}/users/avatar`, form, {
          headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
          timeout: this.timeout,
        })
        .pipe(catchError((error) => Promise.reject(normalizeUpstreamError(error, 'AUTH-PRO')))),
    );

    await this.upsertShadow(data);
    return data;
  }

  /** Keeps the local shadow row (used for foreign keys, e.g. AiRequestLog) in sync with AUTH-PRO. */
  private async upsertShadow(user: AuthUser): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        avatarUrl: user.avatarUrl,
        metadata: user.metadata as never,
        isEmailVerified: user.isEmailVerified,
      },
      update: {
        email: user.email,
        avatarUrl: user.avatarUrl,
        metadata: user.metadata as never,
        isEmailVerified: user.isEmailVerified,
      },
    });
  }
}
