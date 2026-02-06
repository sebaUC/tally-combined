import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface DailyCompletions {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

interface DailyCost {
  date: string;
  costUsd: number;
}

export interface UsageResult {
  completions: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedInputTokens: number;
    tokensPerRequest: number;
    cacheHitRate: number;
    dailyBreakdown: DailyCompletions[];
  };
  costs: {
    totalCostUsd: number;
    costByLineItem: Record<string, number>;
    dailyCostTrend: DailyCost[];
  };
  periodDays: number;
  periodStart: string;
  periodEnd: string;
}

@Injectable()
export class AdminUsageService {
  private readonly logger = new Logger(AdminUsageService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    const adminKey = this.config.get<string>('OPENAI_ADMIN_KEY');
    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1/organization',
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async getUsage(days: number): Promise<UsageResult> {
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - days);
    start.setUTCHours(0, 0, 0, 0);

    const startTs = Math.floor(start.getTime() / 1000);
    const endTs = Math.floor(now.getTime() / 1000);

    const [completionsData, costsData] = await Promise.all([
      this.fetchAllPages('/usage/completions', {
        start_time: startTs,
        end_time: endTs,
        bucket_width: '1d',
        group_by: ['model'],
      }),
      this.fetchAllPages('/costs', {
        start_time: startTs,
        end_time: endTs,
        bucket_width: '1d',
        group_by: ['line_item'],
      }),
    ]);

    const completions = this.aggregateCompletions(completionsData);
    const costs = this.aggregateCosts(costsData);

    return {
      completions,
      costs,
      periodDays: days,
      periodStart: start.toISOString(),
      periodEnd: now.toISOString(),
    };
  }

  private async fetchAllPages(
    endpoint: string,
    params: Record<string, unknown>,
  ): Promise<unknown[]> {
    const allBuckets: unknown[] = [];
    let pageAfter: string | undefined;
    let safetyLimit = 20;

    while (safetyLimit-- > 0) {
      const query: Record<string, unknown> = { ...params, limit: 7 };
      if (pageAfter) {
        query.page = pageAfter;
      }

      try {
        const { data } = await this.client.get(endpoint, { params: query });
        const buckets = data?.data ?? [];
        allBuckets.push(...buckets);

        if (!data?.has_more) break;
        pageAfter = data.next_page;
        if (!pageAfter) break;
      } catch (err) {
        this.logger.error(
          `OpenAI usage API error on ${endpoint}: ${err.message}`,
        );
        throw err;
      }
    }

    return allBuckets;
  }

  private aggregateCompletions(buckets: any[]) {
    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedInputTokens = 0;

    const dailyMap = new Map<string, DailyCompletions>();

    for (const bucket of buckets) {
      const date = this.tsToDate(bucket.start_time);
      const results = bucket.results ?? [];

      for (const r of results) {
        const reqs = r.num_model_requests ?? 0;
        const input = r.input_tokens ?? 0;
        const output = r.output_tokens ?? 0;
        const cached = r.input_cached_tokens ?? 0;

        totalRequests += reqs;
        totalInputTokens += input;
        totalOutputTokens += output;
        totalCachedInputTokens += cached;

        const existing = dailyMap.get(date) ?? {
          date,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        };
        existing.requests += reqs;
        existing.inputTokens += input;
        existing.outputTokens += output;
        existing.cachedInputTokens += cached;
        dailyMap.set(date, existing);
      }
    }

    const tokensPerRequest =
      totalRequests > 0
        ? Math.round((totalInputTokens + totalOutputTokens) / totalRequests)
        : 0;
    const cacheHitRate =
      totalInputTokens > 0
        ? Math.round((totalCachedInputTokens / totalInputTokens) * 10000) /
          100
        : 0;

    const dailyBreakdown = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCachedInputTokens,
      tokensPerRequest,
      cacheHitRate,
      dailyBreakdown,
    };
  }

  private aggregateCosts(buckets: any[]) {
    let totalCostUsd = 0;
    const lineItemMap = new Map<string, number>();
    const dailyMap = new Map<string, number>();

    for (const bucket of buckets) {
      const date = this.tsToDate(bucket.start_time);
      const results = bucket.results ?? [];

      for (const r of results) {
        const cost = (r.amount?.value ?? 0) / 100; // cents to dollars
        const lineItem = r.line_item ?? 'other';

        totalCostUsd += cost;
        lineItemMap.set(lineItem, (lineItemMap.get(lineItem) ?? 0) + cost);
        dailyMap.set(date, (dailyMap.get(date) ?? 0) + cost);
      }
    }

    totalCostUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000;

    const costByLineItem: Record<string, number> = {};
    for (const [k, v] of lineItemMap.entries()) {
      costByLineItem[k] = Math.round(v * 1_000_000) / 1_000_000;
    }

    const dailyCostTrend: DailyCost[] = Array.from(dailyMap.entries())
      .map(([date, costUsd]) => ({
        date,
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { totalCostUsd, costByLineItem, dailyCostTrend };
  }

  private tsToDate(ts: number): string {
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }
}
