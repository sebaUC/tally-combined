import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { MessagesQueryDto } from '../dto/query.dto';

export interface MessageLogEntry {
  id: string;
  user_id: string | null;
  channel: string | null;
  user_message: string;
  bot_response: string | null;
  phase_a_debug: Record<string, unknown> | null;
  phase_b_debug: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export interface MessageLogDetail extends MessageLogEntry {
  user_email?: string;
}

@Injectable()
export class AdminMessagesService {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async getMessages(query: MessagesQueryDto): Promise<{ data: MessageLogEntry[]; total: number }> {
    let baseQuery = this.supabase
      .from('bot_message_log')
      .select('*', { count: 'exact' });

    // Apply filters
    if (query.userId) {
      baseQuery = baseQuery.eq('user_id', query.userId);
    }

    if (query.channel) {
      baseQuery = baseQuery.eq('channel', query.channel);
    }

    if (query.from) {
      baseQuery = baseQuery.gte('created_at', query.from);
    }

    if (query.to) {
      baseQuery = baseQuery.lte('created_at', query.to);
    }

    if (query.hasError) {
      baseQuery = baseQuery.not('error', 'is', null);
    }

    // Order and paginate
    const { data, error, count } = await baseQuery
      .order('created_at', { ascending: false })
      .range(query.offset || 0, (query.offset || 0) + (query.limit || 50) - 1);

    if (error) {
      console.error('[AdminMessagesService] Error fetching messages:', error);
      throw new Error('Failed to fetch messages');
    }

    return {
      data: data || [],
      total: count || 0,
    };
  }

  async getMessageById(id: string): Promise<MessageLogDetail | null> {
    const { data: message, error } = await this.supabase
      .from('bot_message_log')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      console.error('[AdminMessagesService] Error fetching message:', error);
      throw new Error('Failed to fetch message');
    }

    // Try to get user email if user_id exists
    let userEmail: string | undefined;
    if (message.user_id) {
      const { data: userData } = await this.supabase.auth.admin.getUserById(message.user_id);
      userEmail = userData?.user?.email;
    }

    return {
      ...message,
      user_email: userEmail,
    };
  }

  async getUserChat(userId: string, limit = 50): Promise<MessageLogEntry[]> {
    const { data, error } = await this.supabase
      .from('bot_message_log')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[AdminMessagesService] Error fetching user chat:', error);
      throw new Error('Failed to fetch user chat');
    }

    return data || [];
  }

  async getErrors(limit = 50, offset = 0): Promise<{ data: MessageLogEntry[]; total: number }> {
    const { data, error, count } = await this.supabase
      .from('bot_message_log')
      .select('*', { count: 'exact' })
      .not('error', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[AdminMessagesService] Error fetching errors:', error);
      throw new Error('Failed to fetch errors');
    }

    return {
      data: data || [],
      total: count || 0,
    };
  }
}
