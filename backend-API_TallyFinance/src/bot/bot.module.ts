import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { CommonModule } from '../common/common.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { ConversationService } from './services/conversation.service';
import { MetricsService } from './services/metrics.service';
import { CooldownService } from './services/cooldown.service';
import { StyleDetectorService } from './services/style-detector.service';
import { OrchestratorClient } from './services/orchestrator.client';
import { GuardrailsService } from './services/guardrails.service';
import { ToolRegistry } from './tools/tool-registry';

@Module({
  imports: [CommonModule, SupabaseModule],
  controllers: [BotController],
  providers: [
    BotService,
    BotChannelService,
    WhatsappAdapter,
    TelegramAdapter,
    UserContextService,
    ConversationService,
    MetricsService,
    CooldownService,
    StyleDetectorService,
    OrchestratorClient,
    GuardrailsService,
    ToolRegistry,
  ],
  exports: [
    BotService,
    UserContextService,
    ConversationService,
    MetricsService,
    CooldownService,
    OrchestratorClient,
    GuardrailsService,
    ToolRegistry,
  ],
})
export class BotModule {}
