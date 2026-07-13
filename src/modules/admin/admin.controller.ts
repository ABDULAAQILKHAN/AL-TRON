import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiEnvelopedOkResponse } from '../../common/decorators/api-enveloped-response.decorator';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AdminService } from './admin.service';
import { BanUserDto } from './dto/ban-user.dto';
import { SendCustomMailDto } from './dto/send-custom-mail.dto';

// Not JWT-protected by design (AUTH-PRO gates these on `adminPass` in the body instead).
@ApiTags('admin')
@SkipThrottle({ ai: true })
@Public()
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ban a user (adminPass-gated, not JWT-gated)' })
  @ApiEnvelopedOkResponse(MessageResponseDto)
  banUser(@Body() dto: BanUserDto) {
    return this.adminService.banUser(dto);
  }

  @Post('mail/send-custom')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a custom templated email (adminPass-gated, not JWT-gated)' })
  @ApiEnvelopedOkResponse(MessageResponseDto)
  sendCustomMail(@Body() dto: SendCustomMailDto) {
    return this.adminService.sendCustomMail(dto);
  }
}
