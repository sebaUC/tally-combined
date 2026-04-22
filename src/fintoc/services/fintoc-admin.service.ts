import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Admin-only read service over `fintoc_access_log` + `merchants_global`.
 *
 * All endpoints that back this service are AdminGuard-protected in the
 * controller; this service trusts the caller to have passed auth.
 */
@Injectable()
export class FintocAdminService {
  private readonly logger = new Logger(FintocAdminService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  // ── Activity timeline ───────────────────────────────────────────

  /**
   * Returns fintoc_access_log rows filtered by linkId / userId / since,
   * newest first. Useful for debugging "what happened with user X's webhook".
   */
  async getActivity(params: {
    linkId?: string;
    userId?: string;
    since?: string;
    limit: number;
  }): Promise<Record<string, unknown>[]> {
    let query = this.supabase
      .from('fintoc_access_log')
      .select(
        'id, created_at, link_id, user_id, actor_type, actor_id, action, detail',
      )
      .order('created_at', { ascending: false })
      .limit(Math.min(params.limit, 500));

    if (params.linkId) query = query.eq('link_id', params.linkId);
    if (params.userId) query = query.eq('user_id', params.userId);
    if (params.since) query = query.gte('created_at', params.since);

    const { data, error } = await query;
    if (error) {
      this.logger.error(`getActivity failed: ${error.message}`);
      throw new Error(error.message);
    }
    return (data ?? []) as Record<string, unknown>[];
  }

  // ── Resolver stats ──────────────────────────────────────────────

  /**
   * Aggregates `resolver_layer_hit` events over the last `windowHours`.
   * Returns per-source counts and latency percentiles.
   *
   * Supabase does not expose PERCENTILE_CONT via PostgREST, so we pull the
   * (small) event stream back and compute in-memory. If volumes grow past
   * ~50k events/window, push this to a SQL function.
   */
  async getResolverStats(windowHours: number): Promise<ResolverStats> {
    const since = new Date(
      Date.now() - windowHours * 60 * 60 * 1000,
    ).toISOString();

    const { data: hits, error: hitsErr } = await this.supabase
      .from('fintoc_access_log')
      .select('detail')
      .eq('action', 'resolver_layer_hit')
      .gte('created_at', since)
      .limit(50000);

    if (hitsErr) {
      this.logger.error(`getResolverStats hits failed: ${hitsErr.message}`);
      throw new Error(hitsErr.message);
    }

    const bySource: Record<string, number[]> = {
      catalog: [],
      trgm: [],
      embedding: [],
      llm: [],
      none: [],
    };

    for (const row of hits ?? []) {
      const detail = (row as { detail: Record<string, unknown> | null }).detail;
      if (!detail) continue;
      const source = typeof detail.source === 'string' ? detail.source : null;
      const latency =
        typeof detail.latency_ms === 'number' ? detail.latency_ms : null;
      if (!source || latency === null) continue;
      if (!(source in bySource)) bySource[source] = [];
      bySource[source].push(latency);
    }

    const totalCalls = Object.values(bySource).reduce(
      (acc, arr) => acc + arr.length,
      0,
    );

    const by_source: ResolverStats['by_source'] = {};
    for (const [source, latencies] of Object.entries(bySource)) {
      const count = latencies.length;
      const pct =
        totalCalls === 0 ? 0 : Math.round((count / totalCalls) * 1000) / 10;
      by_source[source] = {
        count,
        pct,
        latency_p50_ms: percentile(latencies, 50),
        latency_p95_ms: percentile(latencies, 95),
      };
    }

    // Count merchants created by LLM in window + total pending verification
    const { count: createdInWindow } = await this.supabase
      .from('fintoc_access_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'resolver_merchant_created')
      .gte('created_at', since);

    const { count: pending } = await this.supabase
      .from('merchants_global')
      .select('id', { count: 'exact', head: true })
      .eq('verified', false);

    return {
      window_hours: windowHours,
      total_calls: totalCalls,
      by_source,
      merchants_created_by_llm: createdInWindow ?? 0,
      pending_verification: pending ?? 0,
    };
  }

  // ── Recent merchants ────────────────────────────────────────────

  /**
   * Lists merchants_global rows, newest first. Filter by verified=true/false
   * to review what the LLM created vs what the admin confirmed.
   */
  async getRecentMerchants(params: {
    limit: number;
    verified?: boolean;
  }): Promise<Record<string, unknown>[]> {
    let query = this.supabase
      .from('merchants_global')
      .select(
        'id, name, aliases, default_category, logo_url, verified, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(Math.min(params.limit, 200));

    if (typeof params.verified === 'boolean') {
      query = query.eq('verified', params.verified);
    }

    const { data, error } = await query;
    if (error) {
      this.logger.error(`getRecentMerchants failed: ${error.message}`);
      throw new Error(error.message);
    }
    return (data ?? []) as Record<string, unknown>[];
  }
}

export interface ResolverStats {
  window_hours: number;
  total_calls: number;
  by_source: Record<
    string,
    { count: number; pct: number; latency_p50_ms: number; latency_p95_ms: number }
  >;
  merchants_created_by_llm: number;
  pending_verification: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return Math.round(sorted[lo]);
  const weight = rank - lo;
  return Math.round(sorted[lo] * (1 - weight) + sorted[hi] * weight);
}
