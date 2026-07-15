import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiEnvelopedOkResponse } from '../../common/decorators/api-enveloped-response.decorator';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

// Not an AI/automation endpoint — only the standard "default" throttler tier applies.
@ApiTags('auth')
@SkipThrottle({ ai: true })
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Create an account via AUTH-PRO' })
  @ApiEnvelopedOkResponse(TokenResponseDto)
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange email/password for an AUTH-PRO access token' })
  @ApiEnvelopedOkResponse(TokenResponseDto)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger a password-reset email via AUTH-PRO' })
  @ApiEnvelopedOkResponse(MessageResponseDto)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('update-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiEnvelopedOkResponse(MessageResponseDto)
  updatePassword(@Body() dto: UpdatePasswordDto) {
    return this.authService.updatePassword(dto);
  }
}
