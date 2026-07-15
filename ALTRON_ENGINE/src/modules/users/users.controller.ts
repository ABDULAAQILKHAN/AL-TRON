import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiEnvelopedOkResponse } from '../../common/decorators/api-enveloped-response.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SWAGGER_BEARER_AUTH_NAME } from '../../config/swagger.config';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

// Not an AI/automation endpoint — only the standard "default" throttler tier applies.
@ApiTags('users')
@ApiBearerAuth(SWAGGER_BEARER_AUTH_NAME)
@SkipThrottle({ ai: true })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current user, as resolved by AuthProGuard' })
  @ApiEnvelopedOkResponse(UserResponseDto)
  getMe(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Deep-merge metadata onto the current user via AUTH-PRO' })
  @ApiEnvelopedOkResponse(UserResponseDto)
  updateMe(@AccessToken() token: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(token, dto);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an avatar image via AUTH-PRO' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiEnvelopedOkResponse(UserResponseDto)
  uploadAvatar(@AccessToken() token: string, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadAvatar(token, file);
  }
}
