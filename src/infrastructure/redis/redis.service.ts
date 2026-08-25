import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { Env } from '../../config/env.schema';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      keyPrefix: config.get('REDIS_KEY_PREFIX', { infer: true }),
      lazyConnect: false,
      enableAutoPipelining: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 2_000,
    });

    this.client.on('error', (error: Error) => this.logger.error(error.message));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
