import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Thin connection wrapper around ioredis, mirroring MongoPrismaService's
 * "extend the client, add Nest lifecycle hooks" pattern. Feature services
 * (e.g. PersonaService) inject this directly rather than talking to ioredis
 * themselves.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    super(configService.get<string>('redis.url') as string, {
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
    this.logger.log('Connected to Redis');
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
