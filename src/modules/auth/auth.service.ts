import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { catchError, firstValueFrom } from 'rxjs';
import { normalizeUpstreamError } from '../../utils/error-handler.util';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

/** Thin proxy in front of AUTH-PRO's auth endpoints — AL-TRON owns no credentials of its own. */
@Injectable()
export class AuthService {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('authPro.baseUrl') as string;
    this.timeout = this.configService.get<number>('authPro.timeoutMs') as number;
  }

  async signup(dto: SignupDto): Promise<{ accessToken: string }> {
    return this.post('/auth/signup', dto);
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    return this.post('/auth/login', dto);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.post('/auth/forgot-password', dto);
  }

  async updatePassword(dto: UpdatePasswordDto): Promise<{ message: string }> {
    return this.post('/auth/update-password', dto);
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
