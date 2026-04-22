import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

import { NudgeSenderService } from '../nudge-sender.service';
import {
  buildSyncSummary,
  SyncSummaryInput,
} from './sync-summary-builder';

/**
 * First consumer of the Nudge module.
 *
 * Invoked fire-and-forget at the end of `FintocSyncService.syncLink()`.
 * Composes an HTML-formatted debug summary of what the sync did (new tx
 * count, top merchants, resolver breakdown, merchants newly created) and
 * hands it to the sender with `bypassGates=true` so we get unconditional
 * visibility while the rest of the pipeline is still being wired.
 *
 * Skips silently when there's nothing to report (0 new transactions).
 */
@Injectable()
export class FintocSyncDebugTrigger {
  private readonly log = new Logger(FintocSyncDebugTrigger.name);

  constructor(
    private readonly sender: NudgeSenderService,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Entry point. Never throws — caller treats as fire-and-forget.
   */
  async fire(params: {
    linkId: string;
    userId: string;
    totalInserted: number;
    syncStartedAt: Date;
  }): Promise<void> {
    try {
      if (params.totalInserted === 0) return; // nothing new to say

      const summary = await this.computeSummary(params);
      const text = buildSyncSummary(summary);
      if (!text) return;

      await this.sender.send({
        userId: params.userId,
        linkId: params.linkId,
        trigger: 'sync_debug',
        replies: [{ text, parseMode: 'HTML' }],
        severity: 'low',
        bypassGates: true,
      });
    } catch (err) {
      // Debug nudges are never critical. Log and swallow.
      this.log.warn(
        `[nudge:sync_debug] skipped user=${params.userId} link=${params.linkId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── data gathering ──────────────────────────────────────────────

  private async computeSummary(params: {
    linkId: string;
    userId: string;
    totalInserted: number;
    syncStartedAt: Date;
  }): Promise<SyncSummaryInput> {
    const sinceIso = params.syncStartedAt.toISOString();

    const [
      txBreakdown,
      resolverBreakdown,
      newMerchants,
      institutionName,
    ] = await Promise.all([
      this.fetchTransactionBreakdown(params.userId, params.linkId, sinceIso),
      this.fetchResolverBreakdown(params.userId, params.linkId, sinceIso),
      this.fetchNewMerchantsDiscovered(params.userId, params.linkId, sinceIso),
      this.fetchInstitutionName(params.linkId),
    ]);

    return {
      totalInserted: params.totalInserted,
      totalSpent: txBreakdown.totalSpent,
      expenseCount: txBreakdown.expenseCount,
      totalIncome: txBreakdown.totalIncome,
      incomeCount: txBreakdown.incomeCount,
      topMerchants: txBreakdown.topMerchants,
      newMerchantsDiscovered: newMerchants,
      resolverBreakdown,
      institutionName,
    };
  }

  private async fetchTransactionBreakdown(
    userId: string,
    linkId: string,
    sinceIso: string,
  ): Promise<{
    totalSpent: number;
    expenseCount: number;
    totalIncome: number;
    incomeCount: number;
    topMerchants: SyncSummaryInput['topMerchants'];
  }> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select(
        'amount, type, merchant_name, name, category_id, categories(icon)',
      )
      .eq('user_id', userId)
      .eq('fintoc_link_id', linkId)
      .eq('source', 'bank_api')
      .gte('created_at', sinceIso);

    if (error) {
      this.log.warn(`[nudge:sync_debug] tx query failed: ${error.message}`);
      return {
        totalSpent: 0,
        expenseCount: 0,
        totalIncome: 0,
        incomeCount: 0,
        topMerchants: [],
      };
    }

    const rows = (data ?? []) as Array<{
      amount: number | string;
      type: string;
      merchant_name: string | null;
      name: string | null;
      category_id: string | null;
      categories: { icon: string | null } | { icon: string | null }[] | null;
    }>;

    let totalSpent = 0;
    let totalIncome = 0;
    let expenseCount = 0;
    let incomeCount = 0;
    const merchantTotals = new Map<
      string,
      { name: string; amount: number; icon: string | null }
    >();

    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;

      if (row.type === 'expense') {
        totalSpent += amount;
        expenseCount++;
      } else if (row.type === 'income') {
        totalIncome += amount;
        incomeCount++;
      }

      // Group only expenses by merchant — income rarely has a useful merchant
      if (row.type === 'expense') {
        const key = (row.merchant_name || row.name || '').trim();
        if (!key) continue;
        const icon = this.extractIcon(row.categories);
        const existing = merchantTotals.get(key.toLowerCase());
        if (existing) {
          existing.amount += amount;
        } else {
          merchantTotals.set(key.toLowerCase(), {
            name: key,
            amount,
            icon,
          });
        }
      }
    }

    const topMerchants = Array.from(merchantTotals.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    return { totalSpent, totalIncome, expenseCount, incomeCount, topMerchants };
  }

  private async fetchResolverBreakdown(
    userId: string,
    linkId: string,
    sinceIso: string,
  ): Promise<Record<string, number>> {
    const { data, error } = await this.supabase
      .from('fintoc_access_log')
      .select('detail')
      .eq('user_id', userId)
      .eq('link_id', linkId)
      .eq('action', 'resolver_layer_hit')
      .gte('created_at', sinceIso);

    if (error) {
      this.log.warn(`[nudge:sync_debug] resolver query failed: ${error.message}`);
      return {};
    }

    const breakdown: Record<string, number> = {};
    for (const row of data ?? []) {
      const detail = (row as { detail: Record<string, unknown> | null }).detail;
      const source = detail && typeof detail.source === 'string' ? detail.source : null;
      if (!source) continue;
      breakdown[source] = (breakdown[source] ?? 0) + 1;
    }
    return breakdown;
  }

  private async fetchNewMerchantsDiscovered(
    userId: string,
    linkId: string,
    sinceIso: string,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('fintoc_access_log')
      .select('detail')
      .eq('user_id', userId)
      .eq('link_id', linkId)
      .eq('action', 'resolver_merchant_created')
      .gte('created_at', sinceIso);

    if (error) return [];

    const names: string[] = [];
    for (const row of data ?? []) {
      const detail = (row as { detail: Record<string, unknown> | null }).detail;
      const name =
        detail && typeof detail.merchant_name === 'string'
          ? detail.merchant_name
          : null;
      if (name) names.push(name);
    }
    return names;
  }

  private async fetchInstitutionName(linkId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('fintoc_links')
      .select('institution_name')
      .eq('id', linkId)
      .maybeSingle();

    if (error || !data) return null;
    return (data.institution_name as string) ?? null;
  }

  private extractIcon(
    categories:
      | { icon: string | null }
      | { icon: string | null }[]
      | null,
  ): string | null {
    if (!categories) return null;
    if (Array.isArray(categories)) return categories[0]?.icon ?? null;
    return categories.icon ?? null;
  }
}
