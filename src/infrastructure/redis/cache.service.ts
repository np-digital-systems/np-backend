import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from '../../config/env.schema';
import { RedisService } from './redis.service';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.defaultTtl = config.get('CACHE_TTL_SECONDS', { infer: true });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn(`cache read failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = this.defaultTtl): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`cache write failed for ${key}: ${(error as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    try {
      await this.redis.client.del(...keys);
    } catch (error) {
      this.logger.warn(`cache eviction failed: ${(error as Error).message}`);
    }
  }

  async wrap<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await load();
    await this.set(key, value, ttlSeconds);

    return value;
  }
}
