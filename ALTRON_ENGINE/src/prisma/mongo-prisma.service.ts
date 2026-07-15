import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/mongo-client';

/**
 * Separate PrismaClient for the MongoDB "memory layer", generated from
 * prisma/mongo/schema.prisma. Kept apart from PrismaService (Postgres) because
 * a single Prisma schema can only target one datasource provider.
 */
@Injectable()
export class MongoPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoPrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to MongoDB (memory layer)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
