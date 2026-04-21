import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { TelegramWebhookGuard } from './guards/telegram-webhook.guard';
import { WhatsappWebhookGuard } from './guards/whatsapp-webhook.guard';
import { CommonModule } from '../common/common.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { MetricsService } from './services/metrics.service';
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
    MetricsService,
    MessageLogService,
    ResponseBuilderService,
    CallbackHandlerService,
    ConversationV3Service,
    BotV3Service,
    TelegramWebhookGuard,
    // WhatsappWebhookGuard — disabled until WHATSAPP_APP_SECRET is set.
    // The guard fails fast at boot if the env var is missing, so keep it
    // out of providers while WhatsApp is not in use.
    { provide: 'USER_CONTEXT_SERVICE', useExisting: UserContextService },
    { provide: 'MESSAGE_LOG_SERVICE', useExisting: MessageLogService },
  ],
  exports: [
    BotV3Service,
    UserContextService,
    MetricsService,
    MessageLogService,
    ResponseBuilderService,
  ],
})
export class BotModule {}
