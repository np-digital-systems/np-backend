import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { Env } from '../../config/env.schema';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: config.get('DATABASE_POOL_MAX', { infer: true }),
      idleTimeoutMillis: config.get('DATABASE_POOL_IDLE_TIMEOUT_MS', { infer: true }),
      connectionTimeoutMillis: config.get('DATABASE_CONNECT_TIMEOUT_MS', { infer: true }),
      statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS', { infer: true }),
      application_name: 'np-backend',
      keepAlive: true,
    });

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database pool ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
