import { Module } from '@nestjs/common';

import { BotModule } from '../bot/bot.module';
import { NudgeSenderService } from './nudge-sender.service';

/**
 * Nudge module — server-initiated outbound messages to the user.
 *
 * Foundation for PLAN_GUS_PROACTIVO (nightly summary, anomaly alerts,
 * category assist, subscription detection) and PLAN_USER_INSIGHTS
 * (welcome report).
 *
 * Contract:
 *   - A single service, `NudgeSenderService`, is the only exit point for
 *     outbound messages. Everything that wants to send a push goes through
 *     it.
 *   - Triggers live in `triggers/`. Each trigger is responsible for deciding
 *     WHEN to send and composing the payload; the sender is responsible for
 *     channel routing and logging.
 *
 * Imports:
 *   - `BotModule` — for `TelegramAdapter`, the underlying delivery mechanism.
 */
@Module({
  imports: [BotModule],
  providers: [NudgeSenderService],
  exports: [NudgeSenderService],
})
export class NudgeModule {}
