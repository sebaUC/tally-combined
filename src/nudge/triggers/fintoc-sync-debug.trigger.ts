import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

import { startOfChileDayInUtc } from '../../bot/v3/functions/shared/chile-time';
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
   *
   * Runs on EVERY webhook, including "nothing new" refreshes. Emits a
   * short heartbeat message in that case so we can visually confirm the
   * webhook → sync → Telegram pipeline is healthy. Will graduate to
   * movements-only or gated-by-preference once PLAN_GUS_PROACTIVO F1 ships.
   */
  async fire(params: {
    linkId: string;
    userId: string;
    totalInserted: number;
    syncStartedAt: Date;
  }): Promise<void> {
    try {
      const summary = await this.computeSummary(params);
      const text = buildSyncSummary(summary);

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
      todayTotals,
      lastSeenTx,
    ] = await Promise.all([
      this.fetchTransactionBreakdown(params.userId, params.linkId, sinceIso),
      this.fetchResolverBreakdown(params.userId, params.linkId, sinceIso),
      this.fetchNewMerchantsDiscovered(params.userId, params.linkId, sinceIso),
      this.fetchInstitutionName(params.linkId),
      this.fetchTodayTotals(params.userId, params.linkId),
      this.fetchLastSeenTx(params.userId, params.linkId),
    ]);

    return {
      totalInserted: params.totalInserted,
      totalSpent: txBreakdown.totalSpent,
      expenseCount: txBreakdown.expenseCount,
      totalIncome: txBreakdown.totalIncome,
      incomeCount: txBreakdown.incomeCount,
      topMerchants: txBreakdown.topMerchants,
      newMovements: txBreakdown.newMovements,
      newMerchantsDiscovered: newMerchants,
      resolverBreakdown,
      institutionName,
      todayTotals,
      lastSeenTx,
      syncCompletedAt: new Date(),
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
    newMovements: SyncSummaryInput['newMovements'];
  }> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select(
        'amount, type, merchant_name, name, raw_description, posted_at, transaction_at, resolver_source, category_id, categories(name, icon)',
      )
      .eq('user_id', userId)
      .eq('fintoc_link_id', linkId)
      .eq('source', 'bank_api')
      .gte('created_at', sinceIso)
      .order('posted_at', { ascending: false });

    if (error) {
      this.log.warn(`[nudge:sync_debug] tx query failed: ${error.message}`);
      return {
        totalSpent: 0,
        expenseCount: 0,
        totalIncome: 0,
        incomeCount: 0,
        topMerchants: [],
        newMovements: [],
      };
    }

    const rows = (data ?? []) as Array<{
      amount: number | string;
      type: string;
      merchant_name: string | null;
      name: string | null;
      raw_description: string | null;
      posted_at: string | null;
      transaction_at: string | null;
      resolver_source: string | null;
      category_id: string | null;
      categories:
        | { name: string | null; icon: string | null }
        | { name: string | null; icon: string | null }[]
        | null;
    }>;

    let totalSpent = 0;
    let totalIncome = 0;
    let expenseCount = 0;
    let incomeCount = 0;
    const merchantTotals = new Map<
      string,
      { name: string; amount: number; icon: string | null }
    >();
    const newMovements: SyncSummaryInput['newMovements'] = [];

    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      const merchantName = (row.merchant_name || row.name || 'Sin comercio').trim();
      const cat = this.extractCategory(row.categories);

      if (row.type === 'expense') {
        totalSpent += amount;
        expenseCount++;

        const key = merchantName.toLowerCase();
        const existing = merchantTotals.get(key);
        if (existing) {
          existing.amount += amount;
        } else {
          merchantTotals.set(key, { name: merchantName, amount, icon: cat.icon });
        }
      } else if (row.type === 'income') {
        totalIncome += amount;
        incomeCount++;
      }

      newMovements.push({
        merchantName,
        amount,
        type: row.type === 'income' ? 'income' : 'expense',
        postedAt: row.transaction_at ?? row.posted_at,
        icon: cat.icon,
        resolverSource: row.resolver_source,
        rawDescription: row.raw_description,
        categoryName: cat.name,
      });
    }

    const topMerchants = Array.from(merchantTotals.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    return {
      totalSpent,
      totalIncome,
      expenseCount,
      incomeCount,
      topMerchants,
      newMovements,
    };
  }

  /** Suma del día (Chile-time) para todas las cuentas del link. */
  private async fetchTodayTotals(
    userId: string,
    linkId: string,
  ): Promise<SyncSummaryInput['todayTotals']> {
    const startOfDayUtc = startOfChileDayInUtc();
    const { data, error } = await this.supabase
      .from('transactions')
      .select('amount, type')
      .eq('user_id', userId)
      .eq('fintoc_link_id', linkId)
      .eq('source', 'bank_api')
      .gte('posted_at', startOfDayUtc);

    if (error) {
      this.log.warn(`[nudge:sync_debug] today totals failed: ${error.message}`);
      return { totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0 };
    }
    let totalSpent = 0;
    let totalIncome = 0;
    let expenseCount = 0;
    let incomeCount = 0;
    for (const row of (data ?? []) as Array<{ amount: number | string; type: string }>) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      if (row.type === 'expense') {
        totalSpent += amount;
        expenseCount++;
      } else if (row.type === 'income') {
        totalIncome += amount;
        incomeCount++;
      }
    }
    return { totalSpent, expenseCount, totalIncome, incomeCount };
  }

  /** Última transacción conocida del link, para mostrar en heartbeat. */
  private async fetchLastSeenTx(
    userId: string,
    linkId: string,
  ): Promise<SyncSummaryInput['lastSeenTx']> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select('amount, type, merchant_name, name, posted_at, transaction_at')
      .eq('user_id', userId)
      .eq('fintoc_link_id', linkId)
      .eq('source', 'bank_api')
      .order('posted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as {
      amount: number | string;
      type: string;
      merchant_name: string | null;
      name: string | null;
      posted_at: string | null;
      transaction_at: string | null;
    };
    return {
      merchantName: (row.merchant_name || row.name || 'Sin comercio').trim(),
      amount: Number(row.amount),
      type: row.type === 'income' ? 'income' : 'expense',
      postedAt: row.transaction_at ?? row.posted_at,
    };
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

  private extractCategory(
    categories:
      | { name: string | null; icon: string | null }
      | { name: string | null; icon: string | null }[]
      | null,
  ): { name: string | null; icon: string | null } {
    if (!categories) return { name: null, icon: null };
    if (Array.isArray(categories)) {
      return { name: categories[0]?.name ?? null, icon: categories[0]?.icon ?? null };
    }
    return { name: categories.name ?? null, icon: categories.icon ?? null };
  }
}
