import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { FintocApiClient } from './fintoc-api.client';
import { FintocAuditService } from './fintoc-audit.service';
import { FintocCryptoService } from './fintoc-crypto.service';
import { fromFintocMinorUnits } from './fintoc-money';
import { FintocMovement } from '../contracts/fintoc-api.types';
import { MerchantResolverService } from '../../merchants/services/merchant-resolver.service';
import { MerchantPreferencesService } from '../../merchants/services/merchant-preferences.service';
import { ResolverOutput } from '../../merchants/contracts/resolver.types';
import { pickCategoryEmoji } from '../../bot/v3/functions/emoji-mapper';
import { FintocSyncDebugTrigger } from '../../nudge/triggers/fintoc-sync-debug.trigger';

interface FintocAccountRow {
  id: string;
  user_id: string;
  fintoc_account_id: string;
  fintoc_link_id: string;
  currency: string;
}

interface SyncResult {
  accountId: string;
  movementsFetched: number;
  transactionsInserted: number;
}

// Concurrent merchant resolutions per batch. Keeps tail latency bounded when
// Layer 1d (LLM) is hit while not hammering Gemini.
const RESOLVE_BATCH_SIZE = 10;

/**
 * Sincroniza movimientos desde Fintoc hacia `transactions`.
 * Llamada por el webhook handler (account.refresh_intent.succeeded) y
 * también por el initial sync post-exchange en FintocLinkService.
 *
 * Garantías:
 *   - Idempotencia total: `transactions.external_id` UNIQUE + upsert ignoreDuplicates.
 *   - Filtra movements marcados `duplicated` por Fintoc.
 *   - Signo: amount < 0 → expense, amount >= 0 → income. Almacena amount absoluto.
 *   - Status: `reversed` → voided, `pending` → pending, else posted.
 *   - Balance autoritativo desde Fintoc (no derivado de sumar movements).
 *   - Cursor por account: último `posted_at` con source='bank_api'.
 *   - Merchant resolver: 4-layer cascade (catalog/trgm/embedding/llm).
 *   - Categoría: user override per-merchant → default del merchant → auto-create.
 *   - Transfers: `name='Transferencia'`, categoría auto "Transferencia".
 *   - Auto_categorized: true si alguna categoría se pudo asignar en el insert.
 *   - Resolver errors: nunca explotan el sync; el row se inserta con merchant_id=null.
 */
@Injectable()
export class FintocSyncService {
  private readonly logger = new Logger(FintocSyncService.name);

  constructor(
    private readonly api: FintocApiClient,
    private readonly crypto: FintocCryptoService,
    private readonly audit: FintocAuditService,
    private readonly merchantResolver: MerchantResolverService,
    private readonly merchantPrefs: MerchantPreferencesService,
    private readonly syncDebug: FintocSyncDebugTrigger,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Sincroniza todas las cuentas de un link.
   */
  async syncLink(linkId: string): Promise<SyncResult[]> {
    const t0 = Date.now();
    this.logger.log(`[fintoc] sync start link=${linkId}`);
    const accounts = await this.findAccountsForLink(linkId);
    const userId = accounts[0]?.user_id ?? null;

    this.audit.log({
      linkId,
      userId,
      actorType: 'system',
      action: 'sync_started',
      detail: { accounts_count: accounts.length },
    });

    if (accounts.length === 0) {
      this.logger.warn(`[fintoc] sync skipped link=${linkId} reason=no_accounts`);
      this.audit.log({
        linkId,
        actorType: 'system',
        action: 'sync_completed',
        detail: {
          accounts: 0,
          total_inserted: 0,
          duration_ms: Date.now() - t0,
          reason: 'no_accounts',
        },
      });
      return [];
    }

    const results: SyncResult[] = [];

    try {
      await this.crypto.useToken(linkId, async (linkToken) => {
        // Re-consultar cuentas a Fintoc para balances frescos
        const freshAccounts = await this.api.listAccounts(linkToken);
        const balanceByFintocId = new Map(
          freshAccounts.map((a) => [
            a.id,
            {
              current: a.balance.current ?? 0,
              currency: a.currency,
            },
          ]),
        );

        for (const account of accounts) {
          const accT0 = Date.now();
          const since = await this.findLastSyncCursor(account.id);
          const movements = await this.fetchMovements({
            linkToken,
            fintocAccountId: account.fintoc_account_id,
            since,
          });
          const duplicated = movements.filter(
            (m) => m.status === 'duplicated',
          ).length;
          const inserted = await this.persistMovements(account, movements);

          // Balance autoritativo desde Fintoc
          const fresh = balanceByFintocId.get(account.fintoc_account_id);
          await this.touchAccountSynced(account.id, fresh);

          this.logger.log(
            `[fintoc] sync account=${account.id} fetched=${movements.length} inserted=${inserted} since=${since ?? 'none'}`,
          );

          this.audit.log({
            linkId,
            userId: account.user_id,
            actorType: 'system',
            action: 'sync_account_done',
            detail: {
              account_id: account.id,
              fetched: movements.length,
              inserted,
              skipped_duplicated: duplicated,
              duration_ms: Date.now() - accT0,
            },
          });

          results.push({
            accountId: account.id,
            movementsFetched: movements.length,
            transactionsInserted: inserted,
          });
        }
      });

      await this.touchLinkWebhook(linkId);
      const totalInserted = results.reduce(
        (acc, r) => acc + r.transactionsInserted,
        0,
      );
      this.logger.log(
        `[fintoc] sync done link=${linkId} accounts=${results.length}`,
      );
      this.audit.log({
        linkId,
        userId,
        actorType: 'system',
        action: 'sync_completed',
        detail: {
          accounts: results.length,
          total_inserted: totalInserted,
          duration_ms: Date.now() - t0,
        },
      });

      // Fire-and-forget: push a debug summary to the user's Telegram if
      // anything new was imported. Never blocks the sync or throws.
      if (userId && totalInserted > 0) {
        void this.syncDebug
          .fire({
            linkId,
            userId,
            totalInserted,
            syncStartedAt: new Date(t0),
          })
          .catch(() => {
            /* trigger swallows its own errors */
          });
      }

      return results;
    } catch (err) {
      this.audit.log({
        linkId,
        userId,
        actorType: 'system',
        action: 'sync_failed',
        detail: {
          stage: 'syncLink',
          error_message: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - t0,
        },
      });
      throw err;
    }
  }

  // ── helpers ──────────────────────────────────────────────────

  private async findAccountsForLink(
    linkId: string,
  ): Promise<FintocAccountRow[]> {
    const { data, error } = await this.supabase
      .from('accounts')
      .select('id, user_id, fintoc_account_id, fintoc_link_id, currency')
      .eq('fintoc_link_id', linkId)
      .not('fintoc_account_id', 'is', null);

    if (error) {
      throw new Error(`Failed to list accounts for link ${linkId}: ${error.message}`);
    }
    return (data ?? []) as FintocAccountRow[];
  }

  private async findLastSyncCursor(
    accountId: string,
  ): Promise<string | undefined> {
    const { data } = await this.supabase
      .from('transactions')
      .select('posted_at')
      .eq('account_id', accountId)
      .eq('source', 'bank_api')
      .order('posted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.posted_at ?? undefined;
  }

  private async fetchMovements(params: {
    linkToken: string;
    fintocAccountId: string;
    since?: string;
  }): Promise<FintocMovement[]> {
    const all: FintocMovement[] = [];
    // Paginar hasta agotar (protegido por límite de 20 páginas × 300 = 6000)
    for (let page = 1; page <= 20; page++) {
      const batch = await this.api.listMovements({
        linkToken: params.linkToken,
        accountId: params.fintocAccountId,
        since: params.since,
        perPage: 300,
        page,
      });
      all.push(...batch);
      if (batch.length < 300) break;
    }
    return all;
  }

  /**
   * Resolves merchants + categories in parallel batches, builds rows, and
   * upserts with onConflict on external_id.
   */
  private async persistMovements(
    account: FintocAccountRow,
    movements: FintocMovement[],
  ): Promise<number> {
    if (movements.length === 0) return 0;

    const filtered = movements.filter((m) => m.status !== 'duplicated');
    if (filtered.length === 0) return 0;

    // Pre-load the user's categories once, cache by lowercase name for fast lookup.
    const categoryCache = await this.loadUserCategoryCache(account.user_id);

    const rows: Record<string, unknown>[] = [];

    for (let i = 0; i < filtered.length; i += RESOLVE_BATCH_SIZE) {
      const chunk = filtered.slice(i, i + RESOLVE_BATCH_SIZE);
      const resolved = await Promise.all(
        chunk.map((m) =>
          this.safeResolve(
            m.description ?? '',
            m.amount < 0,
            account.user_id,
            account.fintoc_link_id,
          ),
        ),
      );

      for (let j = 0; j < chunk.length; j++) {
        const movement = chunk[j];
        const merchantResult = resolved[j];
        const categoryId = await this.resolveCategoryId(
          account.user_id,
          merchantResult,
          categoryCache,
        );
        rows.push(
          this.movementToInsertRow(
            account,
            movement,
            merchantResult,
            categoryId,
          ),
        );
      }
    }

    if (rows.length === 0) return 0;

    // Idempotencia: `transactions.external_id` es UNIQUE (WHERE NOT NULL).
    const { data, error } = await this.supabase
      .from('transactions')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id');

    if (error) {
      throw new Error(`Failed to upsert movements: ${error.message}`);
    }
    return data?.length ?? 0;
  }

  /**
   * Wrapper around MerchantResolverService.resolve that never throws.
   * Falls back to a minimal "none" result on unexpected failure.
   * Emits one `resolver_layer_hit` audit entry per call (fire-and-forget)
   * plus `resolver_merchant_created` when Layer 1d inserts a new merchant.
   */
  private async safeResolve(
    rawDescription: string,
    isExpense: boolean,
    userId: string,
    linkId: string,
  ): Promise<ResolverOutput> {
    const preview = rawDescription.trim().slice(0, 40);
    try {
      const result = await this.merchantResolver.resolve({ rawDescription });

      this.audit.log({
        userId,
        linkId,
        actorType: 'system',
        action: 'resolver_layer_hit',
        detail: {
          source: result.source,
          latency_ms: result.latencyMs,
          merchant_id: result.merchantId,
          raw_preview: preview,
        },
      });

      if (result.created && result.merchantId) {
        this.audit.log({
          userId,
          linkId,
          actorType: 'system',
          action: 'resolver_merchant_created',
          detail: {
            merchant_id: result.merchantId,
            merchant_name: result.name,
            default_category: result.defaultCategory,
            raw_preview: preview,
          },
        });
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[fintoc] resolver error raw="${preview}": ${errorMessage}`,
      );
      this.audit.log({
        userId,
        linkId,
        actorType: 'system',
        action: 'resolver_layer_hit',
        detail: {
          source: 'none',
          latency_ms: 0,
          merchant_id: null,
          raw_preview: preview,
          error_message: errorMessage,
        },
      });
      return {
        merchantId: null,
        name: rawDescription.trim().slice(0, 40) || (isExpense ? 'Gasto' : 'Ingreso'),
        logoUrl: null,
        defaultCategory: null,
        source: 'none',
        latencyMs: 0,
      };
    }
  }

  /**
   * Resolves the final category_id for a movement:
   *   1. Per-user preference for this merchant (if any).
   *   2. Merchant's default_category, looked up or created in user's categories.
   *   3. null if no default available or creation fails.
   */
  private async resolveCategoryId(
    userId: string,
    resolved: ResolverOutput,
    categoryCache: Map<string, string>,
  ): Promise<string | null> {
    // 1. User preference for this merchant (only meaningful when merchantId exists).
    if (resolved.merchantId) {
      const preferred = await this.merchantPrefs.getCategoryFor(
        userId,
        resolved.merchantId,
      );
      if (preferred) return preferred;
    }

    // 2. Merchant default, looked up or created in the user's categories.
    if (resolved.defaultCategory) {
      return this.ensureCategoryId(
        userId,
        resolved.defaultCategory,
        categoryCache,
      );
    }

    return null;
  }

  /**
   * Loads the user's categories and returns a cache keyed by lowercased name.
   */
  private async loadUserCategoryCache(
    userId: string,
  ): Promise<Map<string, string>> {
    const cache = new Map<string, string>();
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId);

    if (error) {
      this.logger.warn(
        `[fintoc] load categories failed user=${userId}: ${error.message}`,
      );
      return cache;
    }

    for (const row of data ?? []) {
      cache.set(row.name.toLowerCase(), row.id);
    }
    return cache;
  }

  /**
   * Looks up a category by (case-insensitive) name in the cache. If missing,
   * inserts it with an auto-picked emoji and writes it back to the cache.
   */
  private async ensureCategoryId(
    userId: string,
    categoryName: string,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const key = categoryName.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;

    const icon = pickCategoryEmoji(categoryName);
    const { data, error } = await this.supabase
      .from('categories')
      .insert({ user_id: userId, name: categoryName, icon })
      .select('id')
      .single();

    if (error || !data) {
      this.logger.warn(
        `[fintoc] auto-create category "${categoryName}" failed user=${userId}: ${error?.message}`,
      );
      return null;
    }
    cache.set(key, data.id);
    return data.id;
  }

  private movementToInsertRow(
    account: FintocAccountRow,
    movement: FintocMovement,
    resolved: ResolverOutput,
    categoryId: string | null,
  ): Record<string, unknown> {
    const signed = fromFintocMinorUnits(movement.amount, movement.currency);
    const amountInUnits = Math.abs(signed);
    const isExpense = movement.amount < 0;

    const status =
      movement.status === 'reversed'
        ? 'voided'
        : movement.pending
          ? 'pending'
          : 'posted';

    return {
      user_id: account.user_id,
      account_id: account.id,
      fintoc_link_id: account.fintoc_link_id,
      external_id: movement.id,
      amount: amountInUnits,
      currency: movement.currency,
      type: isExpense ? 'expense' : 'income',
      source: 'bank_api',
      status,
      posted_at: movement.post_date,
      transaction_at: movement.transaction_date ?? null,
      name: resolved.name || (isExpense ? 'Gasto' : 'Ingreso'),
      description: null,
      raw_description: movement.description ?? null,
      merchant_id: resolved.merchantId,
      // merchant_name se mantiene como snapshot durante la transición.
      // Una migración futura lo dropea una vez que todos los reads usen JOIN.
      merchant_name: resolved.name,
      resolver_source: resolved.source,
      category_id: categoryId,
      auto_categorized: !!categoryId,
      metadata: {
        fintoc: {
          type: movement.type,
          reference_id: movement.reference_id ?? null,
          sender_account: movement.sender_account ?? null,
          recipient_account: movement.recipient_account ?? null,
          comment: movement.comment ?? null,
        },
      },
    };
  }

  private async touchAccountSynced(
    accountId: string,
    freshBalance?: { current: number; currency: string },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
    };
    if (freshBalance) {
      payload.current_balance = fromFintocMinorUnits(
        freshBalance.current,
        freshBalance.currency,
      );
    }
    await this.supabase.from('accounts').update(payload).eq('id', accountId);
  }

  private async touchLinkWebhook(linkId: string): Promise<void> {
    await this.supabase
      .from('fintoc_links')
      .update({
        last_refresh_at: new Date().toISOString(),
        last_webhook_at: new Date().toISOString(),
      })
      .eq('id', linkId);
  }
}
