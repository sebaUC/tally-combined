import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface DashboardStats {
  totalMessages: number;
  uniqueUsers: number;
  errorCount: number;
  errorRate: number;
  messagesByChannel: Record<string, number>;
  recentErrors: Array<{
    id: string;
    error: string;
    created_at: string;
    user_message: string;
  }>;
}

@Injectable()
export class AdminDashboardService {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async getStats(hours: number = 24): Promise<DashboardStats> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Get total messages count
    const { count: totalMessages } = await this.supabase
      .from('bot_message_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since);

    // Get unique users count
    const { data: uniqueUsersData } = await this.supabase
      .from('bot_message_log')
      .select('user_id')
      .gte('created_at', since)
      .not('user_id', 'is', null);

    const uniqueUserIds = new Set((uniqueUsersData || []).map(r => r.user_id));
    const uniqueUsers = uniqueUserIds.size;

    // Get error count
    const { count: errorCount } = await this.supabase
      .from('bot_message_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', since)
      .not('error', 'is', null);

    // Get messages by channel
    const { data: channelData } = await this.supabase
      .from('bot_message_log')
      .select('channel')
      .gte('created_at', since);

    const messagesByChannel: Record<string, number> = {};
    for (const row of channelData || []) {
      const ch = row.channel || 'unknown';
      messagesByChannel[ch] = (messagesByChannel[ch] || 0) + 1;
    }

    // Get recent errors (last 10)
    const { data: recentErrorsData } = await this.supabase
      .from('bot_message_log')
      .select('id, error, created_at, user_message')
      .not('error', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    const total = totalMessages || 0;
    const errors = errorCount || 0;

    return {
      totalMessages: total,
      uniqueUsers,
      errorCount: errors,
      errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
      messagesByChannel,
      recentErrors: recentErrorsData || [],
    };
  }
}
