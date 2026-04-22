import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export type FintocAuditAction =
  | 'intent_created'
  | 'exchange_succeeded'
  | 'exchange_failed'
  | 'token_decrypted'
  | 'refresh_triggered'
  | 'webhook_received'
  | 'webhook_processed'
  | 'webhook_invalid_signature'
  | 'webhook_event_ignored'
  | 'link_revoked'
  | 'link_status_changed'
  | 'admin_manual_sync'
  // Sync lifecycle — emitted from FintocSyncService per link/account
  | 'sync_started'
  | 'sync_account_done'
  | 'sync_completed'
  | 'sync_failed'
  // Merchant resolver observability — one per resolve() call
  | 'resolver_layer_hit'
  | 'resolver_merchant_created';

export type FintocAuditActor = 'user' | 'system' | 'webhook' | 'admin';

export interface FintocAuditEntry {
  linkId?: string | null;
  userId?: string | null;
  actorType: FintocAuditActor;
  actorId?: string | null;
  action: FintocAuditAction;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget logger a `fintoc_access_log`.
 * Append-only: la tabla tiene REVOKE UPDATE/DELETE por lo que
 * un atacante con JWT normal no puede alterar la bitácora.
 *
 * Cumple ISO 27001 A.8.15 (logging) y A.8.16 (monitoring).
 */
@Injectable()
export class FintocAuditService {
  private readonly logger = new Logger(FintocAuditService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  log(entry: FintocAuditEntry): void {
    void this.insertAsync(entry).catch((err) => {
      this.logger.error(
        `Failed to write audit log (action=${entry.action}): ${err.message}`,
      );
    });
  }

  private async insertAsync(entry: FintocAuditEntry): Promise<void> {
    const { error } = await this.supabase.from('fintoc_access_log').insert({
      link_id: entry.linkId ?? null,
      user_id: entry.userId ?? null,
      actor_type: entry.actorType,
      actor_id: entry.actorId ?? null,
      action: entry.action,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      detail: entry.detail ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }
  }
}
