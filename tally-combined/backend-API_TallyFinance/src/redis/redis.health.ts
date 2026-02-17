import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Redis health check indicator.
 * Can be used with NestJS Terminus for health endpoints.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(private readonly redis: RedisService) {}

  async check(): Promise<{ redis: { status: string; mode: string } }> {
    const isHealthy = await this.redis.isHealthy();
    const { mode } = this.redis.getStatus();

    return {
      redis: {
        status: isHealthy ? 'up' : 'down',
        mode,
      },
    };
  }
}
