import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom } from 'rxjs';
import { normalizeUpstreamError } from '../../utils/error-handler.util';
import { BanUserDto } from './dto/ban-user.dto';
import { SendCustomMailDto } from './dto/send-custom-mail.dto';

/**
 * Proxies AUTH-PRO's admin endpoints, which authenticate via a shared `adminPass`
 * in the body rather than a bearer token — the gateway forwards it as-is and lets
 * AUTH-PRO be the source of truth for that secret.
 */
@Injectable()
export class AdminService {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('authPro.baseUrl') as string;
    this.timeout = this.configService.get<number>('authPro.timeoutMs') as number;
  }

  async banUser(dto: BanUserDto): Promise<{ message: string }> {
    return this.post('/users/ban', dto);
  }

  async sendCustomMail(dto: SendCustomMailDto): Promise<{ message: string }> {
    return this.post('/mail/send-custom', dto);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const { data } = await firstValueFrom(
      this.httpService.post<T>(`${this.baseUrl}${path}`, body, { timeout: this.timeout }).pipe(
        catchError((error) => {
          throw normalizeUpstreamError(error, 'AUTH-PRO');
        }),
      ),
    );
    return data;
  }
}
