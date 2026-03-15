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

  async getMessages(
    query: MessagesQueryDto,
  ): Promise<{ data: MessageLogEntry[]; total: number }> {
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
      const { data: userData } = await this.supabase.auth.admin.getUserById(
        message.user_id,
      );
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

  async getErrors(
    limit = 50,
    offset = 0,
  ): Promise<{ data: MessageLogEntry[]; total: number }> {
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

  async getUserProfile(userId: string): Promise<{
    email: string | null;
    full_name: string | null;
    personality: { tone: string; intensity: number } | null;
    spending_expectations: Array<{
      period: string;
      active: boolean;
      amount: number;
    }>;
    goals: Array<{
      name: string;
      target_amount: number;
      target_date: string | null;
      status: string;
    }>;
  }> {
    // Get user email and name
    let email: string | null = null;
    let fullName: string | null = null;
    try {
      const { data: userData } =
        await this.supabase.auth.admin.getUserById(userId);
      email = userData?.user?.email || null;
      fullName = userData?.user?.user_metadata?.full_name || null;
    } catch {
      // Ignore errors
    }

    // Get personality
    const { data: personality } = await this.supabase
      .from('personality_snapshot')
      .select('tone, intensity')
      .eq('user_id', userId)
      .single();

    // Get spending expectations
    const { data: spending } = await this.supabase
      .from('spending_expectations')
      .select('period, active, amount')
      .eq('user_id', userId)
      .eq('active', true);

    // Get goals
    const { data: goals } = await this.supabase
      .from('goals')
      .select('name, target_amount, target_date, status')
      .eq('user_id', userId)
      .eq('status', 'in_progress');

    return {
      email,
      full_name: fullName,
      personality: personality
        ? { tone: personality.tone, intensity: personality.intensity }
        : null,
      spending_expectations: spending || [],
      goals: goals || [],
    };
  }

  async getActiveUsers(): Promise<
    Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      message_count: number;
      last_message_at: string;
      has_errors: boolean;
    }>
  > {
    // Fetch ALL messages — Supabase defaults to 1000 rows, so we paginate
    // to avoid silently losing users whose messages fall beyond the limit.
    const PAGE_SIZE = 1000;
    let allMessages: Array<{
      user_id: string;
      created_at: string;
      error: string | null;
    }> = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error } = await this.supabase
        .from('bot_message_log')
        .select('user_id, created_at, error')
        .not('user_id', 'is', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(
          '[AdminMessagesService] Error fetching active users:',
          error,
        );
        throw new Error('Failed to fetch active users');
      }

      allMessages = allMessages.concat(page || []);
      hasMore = (page?.length ?? 0) === PAGE_SIZE;
      offset += PAGE_SIZE;
    }

    // Aggregate by user
    const userMap = new Map<
      string,
      {
        message_count: number;
        last_message_at: string;
        has_errors: boolean;
      }
    >();

    for (const msg of allMessages) {
      if (!msg.user_id) continue;

      const existing = userMap.get(msg.user_id);
      if (existing) {
        existing.message_count++;
        if (msg.error) existing.has_errors = true;
      } else {
        userMap.set(msg.user_id, {
          message_count: 1,
          last_message_at: msg.created_at,
          has_errors: Boolean(msg.error),
        });
      }
    }

    // Get user emails and names
    const userIds = Array.from(userMap.keys());
    const usersWithEmails: Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      message_count: number;
      last_message_at: string;
      has_errors: boolean;
    }> = [];

    for (const userId of userIds) {
      const stats = userMap.get(userId)!;
      let email: string | null = null;
      let fullName: string | null = null;

      try {
        const { data: userData } =
          await this.supabase.auth.admin.getUserById(userId);
        email = userData?.user?.email || null;
        fullName = userData?.user?.user_metadata?.full_name || null;
      } catch {
        // Ignore errors getting email
      }

      usersWithEmails.push({
        user_id: userId,
        email,
        full_name: fullName,
        ...stats,
      });
    }

    // Sort by last message (most recent first)
    usersWithEmails.sort(
      (a, b) =>
        new Date(b.last_message_at).getTime() -
        new Date(a.last_message_at).getTime(),
    );

    return usersWithEmails;
  }
}
