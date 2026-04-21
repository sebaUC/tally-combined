import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { FintocApiClient } from './fintoc-api.client';
import { FintocCryptoService } from './fintoc-crypto.service';
import { fromFintocMinorUnits } from './fintoc-money';
import { FintocMovement } from '../contracts/fintoc-api.types';
import { normalizeTransactionFields } from '../../bot/v3/functions/shared/transaction-normalizer';

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

/**
 * Sincroniza movimientos desde Fintoc hacia `transactions`.
 * Llamada por el webhook handler cuando llega `account.refresh_intent.succeeded`.
 *
 * - Idempotencia por `transactions.external_id` UNIQUE
 * - Respeta signo del amount (negativo = gasto, positivo = ingreso)
 * - Marca `source='bank_api'` y `auto_categorized=true` cuando hay match de merchant
 */
@Injectable()
export class FintocSyncService {
  private readonly logger = new Logger(FintocSyncService.name);

  constructor(
    private readonly api: FintocApiClient,
    private readonly crypto: FintocCryptoService,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Sincroniza todas las cuentas de un link (ej: tras refresh_intent.succeeded).
   */
  async syncLink(linkId: string): Promise<SyncResult[]> {
    this.logger.log(`[fintoc] sync start link=${linkId}`);
    const accounts = await this.findAccountsForLink(linkId);
    if (accounts.length === 0) {
      this.logger.warn(`[fintoc] sync skipped link=${linkId} reason=no_accounts`);
      return [];
    }

    const results: SyncResult[] = [];

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
        const since = await this.findLastSyncCursor(account.id);
        const movements = await this.fetchMovements({
          linkToken,
          fintocAccountId: account.fintoc_account_id,
          since,
        });
        const inserted = await this.persistMovements(account, movements);

        // Balance autoritativo desde Fintoc
        const fresh = balanceByFintocId.get(account.fintoc_account_id);
        await this.touchAccountSynced(account.id, fresh);

        this.logger.log(
          `[fintoc] sync account=${account.id} fetched=${movements.length} inserted=${inserted} since=${since ?? 'none'}`,
        );

        results.push({
          accountId: account.id,
          movementsFetched: movements.length,
          transactionsInserted: inserted,
        });
      }
    });

    await this.touchLinkWebhook(linkId);
    this.logger.log(
      `[fintoc] sync done link=${linkId} accounts=${results.length}`,
    );
    return results;
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

  private async persistMovements(
    account: FintocAccountRow,
    movements: FintocMovement[],
  ): Promise<number> {
    if (movements.length === 0) return 0;

    const rows = movements
      .filter((m) => m.status !== 'duplicated')
      .map((m) => this.movementToInsertRow(account, m));

    if (rows.length === 0) return 0;

    // Idempotencia: `transactions.external_id` es UNIQUE (WHERE NOT NULL).
    // ON CONFLICT DO NOTHING deja pasar los duplicados sin romper el batch.
    const { data, error } = await this.supabase
      .from('transactions')
      .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true })
      .select('id');

    if (error) {
      throw new Error(`Failed to upsert movements: ${error.message}`);
    }
    return data?.length ?? 0;
  }

  private movementToInsertRow(
    account: FintocAccountRow,
    movement: FintocMovement,
  ): Record<string, unknown> {
    const signed = fromFintocMinorUnits(movement.amount, movement.currency);
    const amountInUnits = Math.abs(signed);
    const isExpense = movement.amount < 0;

    const normalized = normalizeTransactionFields({
      description: movement.description,
      userCategory: null,
      fallbackName: isExpense ? 'Gasto' : 'Ingreso',
    });

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
      name: normalized.name,
      description: null,
      raw_description: normalized.raw_description,
      merchant_name: normalized.merchant_name,
      auto_categorized: normalized.auto_categorized,
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
