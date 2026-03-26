import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { CommonModule } from '../common/common.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { ConversationHistoryService } from './services/conversation-history.service';
import { MetricsService } from './services/metrics.service';
import { CooldownService } from './services/cooldown.service';
import { GuardrailsService } from './services/guardrails.service';
import { MessageLogService } from './services/message-log.service';
import { ResponseBuilderService } from './services/response-builder.service';
import { CallbackHandlerService } from './services/callback-handler.service';
import { BotV3Service } from './v3/bot-v3.service';
import { ConversationV3Service } from './v3/conversation-v3.service';

@Module({
  imports: [CommonModule, SupabaseModule],
  controllers: [BotController],
  providers: [
    BotChannelService,
    WhatsappAdapter,
    TelegramAdapter,
    UserContextService,
    ConversationHistoryService,
    MetricsService,
    CooldownService,
    GuardrailsService,
    MessageLogService,
    ResponseBuilderService,
    CallbackHandlerService,
    // V3 pipeline
    ConversationV3Service,
    BotV3Service,
    { provide: 'USER_CONTEXT_SERVICE', useExisting: UserContextService },
    { provide: 'MESSAGE_LOG_SERVICE', useExisting: MessageLogService },
  ],
  exports: [
    BotV3Service,
    UserContextService,
    ConversationHistoryService,
    MetricsService,
    CooldownService,
    GuardrailsService,
    MessageLogService,
    ResponseBuilderService,
  ],
})
export class BotModule {}
