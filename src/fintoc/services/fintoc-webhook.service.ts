import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RedisService } from '../../redis/redis.service';
import { FintocAuditService } from './fintoc-audit.service';
import { FintocSyncService } from './fintoc-sync.service';
import {
  FINTOC_LINK_STATUS,
  FINTOC_REDIS_KEYS,
  FINTOC_WEBHOOK_DEDUP_TTL_SECONDS,
} from '../constants/fintoc.constants';
import {
  FintocEventType,
  isHandledEvent,
} from '../contracts/fintoc-events.enum';
import { FintocWebhookEvent } from '../contracts/fintoc-api.types';

interface ProcessResult {
  deduplicated: boolean;
  handled: boolean;
  eventType: string;
}

/**
 * Procesa webhooks de Fintoc:
 *   1. Idempotencia (Redis SETNX por evt.id)
 *   2. Dispatch por event.type
 *   3. Audit log de cada paso
 *
 * Todas las operaciones son idempotentes — el mismo evento procesado 2 veces
 * no genera efectos secundarios.
 */
@Injectable()
export class FintocWebhookService {
  private readonly logger = new Logger(FintocWebhookService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly audit: FintocAuditService,
    private readonly sync: FintocSyncService,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  async process(event: FintocWebhookEvent): Promise<ProcessResult> {
    this.logger.log(
      `[fintoc] webhook received id=${event.id} type=${event.type} mode=${event.mode}`,
    );

    const firstTime = await this.redis.acquireLock(
      FINTOC_REDIS_KEYS.event(event.id),
      FINTOC_WEBHOOK_DEDUP_TTL_SECONDS * 1000,
    );

    if (!firstTime) {
      this.logger.log(`[fintoc] webhook dedup id=${event.id}`);
      return {
        deduplicated: true,
        handled: false,
        eventType: event.type,
      };
    }

    this.audit.log({
      actorType: 'webhook',
      action: 'webhook_received',
      detail: {
        event_id: event.id,
        event_type: event.type,
        mode: event.mode,
      },
    });

    const handled = await this.dispatch(event);

    this.logger.log(
      `[fintoc] webhook done id=${event.id} type=${event.type} handled=${handled}`,
    );

    this.audit.log({
      actorType: 'webhook',
      action: 'webhook_processed',
      detail: {
        event_id: event.id,
        event_type: event.type,
        handled,
      },
    });

    return { deduplicated: false, handled, eventType: event.type };
  }

  private async dispatch(event: FintocWebhookEvent): Promise<boolean> {
    if (!isHandledEvent(event.type)) {
      this.logger.log(`Ignoring unhandled event type: ${event.type}`);
      return false;
    }

    switch (event.type) {
      case FintocEventType.REFRESH_SUCCEEDED:
      case FintocEventType.MOVEMENTS_MODIFIED:
        await this.handleRefreshSucceeded(event);
        return true;

      case FintocEventType.MOVEMENTS_REMOVED:
        await this.handleMovementsRemoved(event);
        return true;

      case FintocEventType.REFRESH_FAILED:
        await this.markLinkStatus(event, FINTOC_LINK_STATUS.INVALID);
        return true;

      case FintocEventType.REFRESH_REJECTED:
      case FintocEventType.CREDENTIALS_CHANGED:
        await this.markLinkStatus(event, FINTOC_LINK_STATUS.CREDENTIALS_CHANGED);
        return true;

      default:
        return false;
    }
  }

  private async handleRefreshSucceeded(
    event: FintocWebhookEvent,
  ): Promise<void> {
    const linkId = await this.resolveLocalLinkId(event);
    if (!linkId) return;
    try {
      await this.sync.syncLink(linkId);
    } catch (err) {
      this.logger.error(
        `Sync failed for link ${linkId} on event ${event.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async handleMovementsRemoved(
    event: FintocWebhookEvent,
  ): Promise<void> {
    // Los eventos traen `data.movements: [{ id, ... }]`
    const removedIds = this.extractMovementIds(event);
    if (removedIds.length === 0) return;

    await this.supabase
      .from('transactions')
      .update({ status: 'voided' })
      .in('external_id', removedIds);
  }

  private async markLinkStatus(
    event: FintocWebhookEvent,
    status: string,
  ): Promise<void> {
    const linkId = await this.resolveLocalLinkId(event);
    if (!linkId) return;

    await this.supabase
      .from('fintoc_links')
      .update({
        status,
        last_webhook_at: new Date().toISOString(),
      })
      .eq('id', linkId);

    this.audit.log({
      linkId,
      actorType: 'webhook',
      action: 'link_status_changed',
      detail: { status, event_type: event.type },
    });
  }

  private async resolveLocalLinkId(
    event: FintocWebhookEvent,
  ): Promise<string | null> {
    const data = (event.data ?? {}) as Record<string, any>;

    // Shape 1: refresh_intent events reference an account, not a link.
    // The accounts table stores our internal link UUID in fintoc_link_id.
    // Fintoc sends: { refreshed_object: 'account', refreshed_object_id: 'acc_...' }
    if (
      data?.refreshed_object === 'account' &&
      typeof data?.refreshed_object_id === 'string'
    ) {
      const { data: account } = await this.supabase
        .from('accounts')
        .select('fintoc_link_id')
        .eq('fintoc_account_id', data.refreshed_object_id)
        .maybeSingle();
      if (account?.fintoc_link_id) return account.fintoc_link_id;
    }

    // Shape 2: events that embed the Fintoc link id directly in the payload.
    const candidate =
      data?.link?.id ??
      data?.link_id ??
      data?.account?.link?.id ??
      data?.account?.link_id ??
      null;

    if (!candidate || typeof candidate !== 'string') {
      // Dump the data keys + truncated payload so we can extend the resolver
      // if Fintoc introduces another shape in the future.
      this.logger.warn(
        `Event ${event.id} (${event.type}) has no resolvable link id. ` +
          `data_keys=${Object.keys(data).join(',')} ` +
          `data=${JSON.stringify(data).slice(0, 400)}`,
      );
      return null;
    }

    const { data: link } = await this.supabase
      .from('fintoc_links')
      .select('id')
      .eq('fintoc_link_id', candidate)
      .maybeSingle();

    return link?.id ?? null;
  }

  private extractMovementIds(event: FintocWebhookEvent): string[] {
    const data = (event.data ?? {}) as Record<string, any>;
    const items = data.movements ?? data.items ?? [];
    if (!Array.isArray(items)) return [];
    return items
      .map((m: any) => (typeof m === 'string' ? m : m?.id))
      .filter((id): id is string => typeof id === 'string');
  }
}
