import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { throttlerConfigFactory } from './config/throttler.config';
import { validationSchema } from './config/validation.schema';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthProGuard } from './common/guards/auth-pro.guard';
import { GlobalHttpModule } from './common/http/global-http.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MemoryModule } from './modules/memory/memory.module';
import { UsersModule } from './modules/users/users.module';
import { MongoPrismaModule } from './prisma/mongo-prisma.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: throttlerConfigFactory,
    }),
    GlobalHttpModule,
    PrismaModule,
    MongoPrismaModule,
    AuthModule,
    UsersModule,
    AiModule,
    AdminModule,
    HealthModule,
    MemoryModule,
  ],
  providers: [
    // Order matters: rate limiting runs before we bother verifying the caller with AUTH-PRO.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthProGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
