import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';

import { TelegramAdapter } from '../bot/adapters/telegram.adapter';
import { BotReply } from '../bot/actions/action-block';
import type { DomainMessage } from '../bot/contracts';
import { FintocAuditService } from '../fintoc/services/fintoc-audit.service';
import type {
  NudgeSendParams,
  NudgeSendResult,
  NudgeSkipReason,
} from './contracts';

/**
 * Single exit point for every server-initiated outbound message.
 *
 * MVP (today): channel lookup → send → log to bot_message_log + audit.
 *   - No silence window, no rate limit, no notification_level gating yet.
 *   - `sync_debug` trigger uses `bypassGates: true` explicitly, so when we
 *     layer gates in later the intent is self-documenting.
 *
 * Future (PLAN_GUS_PROACTIVO F1+):
 *   - Silence window (2min since last user→bot message)
 *   - Rate limit (5/hour/user via Redis ZSET `nudge:rate:{userId}`)
 *   - `user_prefs.notification_level` gating ('none' → skip)
 *
 * All of these plug into the same `send()` without changing the signature.
 */
@Injectable()
export class NudgeSenderService {
  private readonly log = new Logger(NudgeSenderService.name);
  private readonly globallyEnabled: boolean;

  constructor(
    private readonly telegram: TelegramAdapter,
    private readonly audit: FintocAuditService,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    @Optional() private readonly config?: ConfigService,
  ) {
    // Global kill-switch via env. Defaults to ENABLED.
    const raw = this.config?.get<string>('NUDGE_ENABLED') ?? 'true';
    this.globallyEnabled = raw !== 'false' && raw !== '0';
  }

  /**
   * Delivers the outbound payload to the user's preferred channel.
   * Never throws — callers treat this as fire-and-forget.
   */
  async send(params: NudgeSendParams): Promise<NudgeSendResult> {
    if (!this.globallyEnabled) {
      return this.skip(params, 'disabled_by_flag');
    }

    if (!params.replies || params.replies.length === 0) {
      return this.skip(params, 'empty_payload');
    }

    // TODO(PLAN_GUS_PROACTIVO F1): gate by silence window / rate limit /
    //                              notification_level unless bypassGates.

    const channel = await this.lookupChannel(params.userId);
    if (!channel) {
      return this.skip(params, 'no_channel');
    }

    try {
      for (const reply of params.replies) {
        await this.deliver(channel, reply);
      }
    } catch (err) {
      this.log.warn(
        `[nudge] send failed user=${params.userId} trigger=${params.trigger}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.skip(params, 'send_failed', {
        error_message: err instanceof Error ? err.message : String(err),
      });
    }

    await this.logDelivered(params, channel);

    this.audit.log({
      userId: params.userId,
      linkId: params.linkId ?? null,
      actorType: 'system',
      action: 'nudge_sent',
      detail: {
        trigger: params.trigger,
        severity: params.severity ?? 'low',
        channel: channel.channelType,
        bypass_gates: !!params.bypassGates,
        reply_count: params.replies.length,
      },
    });

    return { sent: true };
  }

  // ── internals ───────────────────────────────────────────────────

  private skip(
    params: NudgeSendParams,
    reason: NudgeSkipReason,
    extraDetail?: Record<string, unknown>,
  ): NudgeSendResult {
    this.audit.log({
      userId: params.userId,
      linkId: params.linkId ?? null,
      actorType: 'system',
      action: 'nudge_skipped',
      detail: {
        trigger: params.trigger,
        reason,
        ...(extraDetail ?? {}),
      },
    });
    return { sent: false, reason };
  }

  /**
   * Finds the user's channel, preferring Telegram over WhatsApp.
   */
  private async lookupChannel(
    userId: string,
  ): Promise<ResolvedChannel | null> {
    const { data, error } = await this.supabase
      .from('channel_accounts')
      .select('channel, external_id')
      .eq('user_id', userId);

    if (error) {
      this.log.warn(`[nudge] channel lookup error: ${error.message}`);
      return null;
    }

    const accounts = (data ?? []) as Array<{
      channel: string;
      external_id: string;
    }>;
    if (accounts.length === 0) return null;

    const telegram = accounts.find((a) => a.channel === 'telegram');
    if (telegram) {
      return { channelType: 'telegram', externalId: telegram.external_id };
    }
    const whatsapp = accounts.find((a) => a.channel === 'whatsapp');
    if (whatsapp) {
      return { channelType: 'whatsapp', externalId: whatsapp.external_id };
    }
    return null;
  }

  private async deliver(
    channel: ResolvedChannel,
    reply: BotReply,
  ): Promise<void> {
    if (channel.channelType !== 'telegram') {
      // WhatsApp outbound wiring lands alongside the proactive pipeline;
      // for now we only skip silently (audit row still records skip reason).
      throw new Error(`channel ${channel.channelType} not supported yet`);
    }

    const dm: DomainMessage = {
      channel: 'telegram',
      externalId: channel.externalId,
      platformMessageId: `nudge-${Date.now()}`,
      text: '',
      timestamp: new Date().toISOString(),
    };

    await this.telegram.sendReply(dm, reply.text, {
      parseMode: reply.parseMode ?? 'HTML',
    });
  }

  /**
   * Persists the outbound message to `bot_message_log` for admin visibility.
   * `nudge_trigger` is set so reactive vs proactive rows are clearly separable.
   */
  private async logDelivered(
    params: NudgeSendParams,
    channel: ResolvedChannel,
  ): Promise<void> {
    const combinedText = params.replies.map((r) => r.text).join('\n\n');
    const { error } = await this.supabase.from('bot_message_log').insert({
      user_id: params.userId,
      channel: channel.channelType,
      user_message: '(server-initiated)',
      bot_response: combinedText.slice(0, 10_000),
      tool_name: null,
      nudge_trigger: params.trigger,
    });

    if (error) {
      this.log.warn(`[nudge] bot_message_log insert failed: ${error.message}`);
    }
  }
}

interface ResolvedChannel {
  channelType: 'telegram' | 'whatsapp';
  externalId: string;
}
