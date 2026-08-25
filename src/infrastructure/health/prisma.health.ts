import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const startedAt = performance.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return check.up({ latencyMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      return check.down({ message: (error as Error).message });
    }
  }
}
