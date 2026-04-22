import { Module, forwardRef } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { FintocAuditService } from '../fintoc/services/fintoc-audit.service';
import { NudgeSenderService } from './nudge-sender.service';
import { FintocSyncDebugTrigger } from './triggers/fintoc-sync-debug.trigger';

/**
 * Nudge module — server-initiated outbound messages to the user.
 *
 * Foundation for PLAN_GUS_PROACTIVO (nightly summary, anomaly alerts,
 * category assist, subscription detection) and PLAN_USER_INSIGHTS
 * (welcome report). The first consumer is `FintocSyncDebugTrigger`, which
 * posts a post-sync debug summary.
 *
 * Contract:
 *   - A single service, `NudgeSenderService`, is the only exit point for
 *     outbound messages. Everything that wants to send a push goes through
 *     it.
 *   - Triggers live in `triggers/`. Each trigger is responsible for deciding
 *     WHEN to send and composing the payload; the sender is responsible for
 *     channel routing, gating (future), and logging.
 *
 * Imports:
 *   - `BotModule` — for `TelegramAdapter`, the underlying delivery mechanism.
 *   - `forwardRef` on BotModule is not required today (no cycle exists), but
 *     kept as a defensive pattern in case future triggers need BotModule
 *     services that depend on nudge outputs.
 */
@Module({
  imports: [BotModule],
  providers: [NudgeSenderService, FintocAuditService, FintocSyncDebugTrigger],
  exports: [NudgeSenderService, FintocSyncDebugTrigger],
})
export class NudgeModule {}
