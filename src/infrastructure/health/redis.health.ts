import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const startedAt = performance.now();

    try {
      await this.redis.client.ping();
      return check.up({ latencyMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      return check.down({ message: (error as Error).message });
    }
  }
}
