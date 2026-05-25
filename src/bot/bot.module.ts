import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { TelegramWebhookGuard } from './guards/telegram-webhook.guard';
import { WhatsappWebhookGuard } from './guards/whatsapp-webhook.guard';
import { CommonModule } from '../common/common.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { InsightsModule } from '../insights/insights.module';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { MetricsService } from './services/metrics.service';
import { MessageLogService } from './services/message-log.service';
import { ResponseBuilderService } from './services/response-builder.service';
import { CallbackHandlerService } from './services/callback-handler.service';
import { BotService } from './bot.service';
import { ConversationService } from './conversation.service';

@Module({
  imports: [CommonModule, SupabaseModule, MerchantsModule, InsightsModule],
  controllers: [BotController],
  providers: [
    BotChannelService,
    WhatsappAdapter,
    TelegramAdapter,
    UserContextService,
    MetricsService,
    MessageLogService,
    ResponseBuilderService,
    CallbackHandlerService,
    ConversationService,
    BotService,
    TelegramWebhookGuard,
    // WhatsappWebhookGuard — disabled until WHATSAPP_APP_SECRET is set.
    // The guard fails fast at boot if the env var is missing, so keep it
    // out of providers while WhatsApp is not in use.
    { provide: 'USER_CONTEXT_SERVICE', useExisting: UserContextService },
    { provide: 'MESSAGE_LOG_SERVICE', useExisting: MessageLogService },
  ],
  exports: [
    BotService,
    UserContextService,
    MetricsService,
    MessageLogService,
    ResponseBuilderService,
    TelegramAdapter,
  ],
})
export class BotModule {}
