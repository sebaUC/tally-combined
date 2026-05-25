import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { InsightsEngineService } from '../engine/insights-engine.service';
import { RedisService } from '../../redis';

const ON_DEMAND_RATE_LIMIT_PER_HOUR = 3;
const ON_DEMAND_RATE_LIMIT_WINDOW_MS = 3600 * 1000;

/**
 * Endpoints internos protegidos por bearer token.
 *
 * Uso esperado:
 *   - /recompute → re-process individual (admin manual, "re-analizá mis datos")
 *   - /batch     → recompute todos los users (cron externo semanal)
 *
 * Rate limit por user en /recompute: 3/hora (Redis-backed).
 */
@Controller('internal/insights')
export class OnDemandController {
  constructor(
    private readonly engine: InsightsEngineService,
    private readonly redis: RedisService,
  ) {}

  @Post('recompute')
  @HttpCode(200)
  async recompute(
    @Headers('authorization') auth: string | undefined,
    @Body() body: { userId: string; lookbackDays?: number },
  ) {
    this.assertServiceToken(auth);
    if (!body?.userId) {
      throw new ForbiddenException('userId requerido');
    }
    await this.assertRateLimit(body.userId);

    const result = await this.engine.recomputeForUser(
      body.userId,
      'manual_recompute',
      body.lookbackDays,
    );
    return {
      ok: true,
      userId: result.userId,
      data_maturity: result.data_maturity,
      tx_count_at_compute: result.tx_count_at_compute,
      computed_at: result.computed_at,
    };
  }

  @Post('batch')
  @HttpCode(200)
  async batch(
    @Headers('authorization') auth: string | undefined,
    @Body() body: { lookbackDays?: number },
  ) {
    this.assertServiceToken(auth);
    const summary = await this.engine.recomputeBatch(body?.lookbackDays);
    return {
      ok: true,
      total_users: summary.totalUsers,
      success_count: summary.ok,
      failed_count: summary.failed,
      failed_ids: summary.failedIds,
    };
  }

  private assertServiceToken(auth: string | undefined): void {
    const expected = process.env.INTERNAL_SERVICE_TOKEN;
    if (!expected) {
      throw new ForbiddenException(
        'INTERNAL_SERVICE_TOKEN no configurado en el server',
      );
    }
    const provided = auth?.replace(/^Bearer\s+/i, '');
    if (provided !== expected) {
      throw new ForbiddenException('Bearer token inválido');
    }
  }

  private async assertRateLimit(userId: string): Promise<void> {
    const key = `insights:ondemand:${userId}`;
    const allowed = await this.redis.rateLimitCheck(
      key,
      ON_DEMAND_RATE_LIMIT_PER_HOUR,
      ON_DEMAND_RATE_LIMIT_WINDOW_MS,
    );
    if (!allowed) {
      throw new HttpException(
        {
          ok: false,
          error: 'RATE_LIMITED',
          message: `Máximo ${ON_DEMAND_RATE_LIMIT_PER_HOUR} recomputes/hora para este user`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
