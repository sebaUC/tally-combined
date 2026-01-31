import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface MessageLogData {
  userId: string | null;
  channel: string;
  userMessage: string;
  botResponse: string | null;
  toolName: string | null;
  phaseADebug: Record<string, unknown> | null;
  phaseBDebug: Record<string, unknown> | null;
  error: string | null;
}

@Injectable()
export class MessageLogService {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async log(data: MessageLogData): Promise<void> {
    try {
      const { error } = await this.supabase.from('bot_message_log').insert({
        user_id: data.userId,
        channel: data.channel,
        user_message: data.userMessage,
        bot_response: data.botResponse,
        tool_name: data.toolName,
        phase_a_debug: data.phaseADebug,
        phase_b_debug: data.phaseBDebug,
        error: data.error,
      });

      if (error) {
        console.error('[MessageLogService] Failed to log message:', error.message);
      }
    } catch (err) {
      // Don't throw - logging failures should not break the bot
      console.error('[MessageLogService] Exception while logging:', err);
    }
  }
}
