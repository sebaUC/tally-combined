import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';

export interface CategoryInfo {
  id: string;
  name: string;
}

export interface BudgetInfo {
  period: string;
  amount: number;
  spent?: number | null;
}

export interface MinimalUserContext {
  userId: string;
  displayName: string | null;
  personality: {
    tone: string | null;
    intensity: number | null;
    mood: string | null;
  } | null;
  prefs: {
    timezone: string | null;
    locale: string | null;
    notificationLevel: string | null;
    unifiedBalance: boolean | null;
  } | null;
  // Multiple active budgets (daily, weekly, monthly)
  activeBudgets: BudgetInfo[];
  // Legacy single budget for backwards compatibility
  activeBudget: {
    period: string | null;
    amount: number | null;
    spent?: number | null;
  } | null;
  goalsCount: number;
  goalsSummary?: string[];
  // User's available categories for transaction matching
  categories?: CategoryInfo[];
}

@Injectable()
export class UserContextService {
  private readonly log = new Logger(UserContextService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly redis: RedisService,
  ) {}

  async getContext(userId: string): Promise<MinimalUserContext> {
    const cacheKey = RedisKeys.userContext(userId);

    // Try Redis cache first
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.log.debug(`[getContext] Redis cache hit for user ${userId}`);
        return JSON.parse(cached) as MinimalUserContext;
      }
    } catch (err) {
      this.log.warn(`[getContext] Redis cache error, falling back to DB`, err);
    }

    this.log.debug(
      `[getContext] Cache miss for user ${userId}, fetching from DB...`,
    );
    const context = await this.fetchContext(userId);

    // Store in Redis cache
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(context),
        RedisTTL.USER_CONTEXT,
      );
    } catch (err) {
      this.log.warn(`[getContext] Failed to cache in Redis`, err);
    }

    return context;
  }

  async invalidate(userId: string): Promise<void> {
    const cacheKey = RedisKeys.userContext(userId);
    try {
      await this.redis.del(cacheKey);
      this.log.debug(`[invalidate] Redis cache cleared for user ${userId}`);
    } catch (err) {
      this.log.warn(`[invalidate] Failed to clear Redis cache`, err);
    }
  }

  private async fetchContext(userId: string): Promise<MinimalUserContext> {
    const [
      { data: profile, error: profileError },
      { data: personality, error: personalityError },
      { data: prefs, error: prefsError },
      { data: spending, error: spendingError },
      { data: goals, error: goalsError },
      { data: categories, error: categoriesError },
    ] = await Promise.all([
      // users table has: full_name, nickname, timezone, locale
      this.supabase
        .from('users')
        .select('id, full_name, nickname, timezone, locale')
        .eq('id', userId)
        .single(),
      this.supabase
        .from('personality_snapshot')
        .select('tone, intensity, mood')
        .eq('user_id', userId)
        .maybeSingle(),
      // user_prefs has: notification_level, unified_balance
      this.supabase
        .from('user_prefs')
        .select('notification_level, unified_balance')
        .eq('id', userId)
        .maybeSingle(),
      this.supabase
        .from('spending_expectations')
        .select('period, amount')
        .eq('user_id', userId)
        .eq('active', true)
        .order('created_at', { ascending: false }),
      this.supabase
        .from('goals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      // Fetch user's categories for transaction matching
      this.supabase.from('categories').select('id, name').eq('user_id', userId),
    ]);

    if (profileError) {
      this.log.error(`[fetchContext] Profile error: ${profileError.message}`);
      throw new Error(`Failed to fetch user profile: ${profileError.message}`);
    }

    if (personalityError) {
      this.log.warn(
        `[fetchContext] Personality error: ${personalityError.message}`,
      );
    }
    if (prefsError) {
      this.log.warn(`[fetchContext] Prefs error: ${prefsError.message}`);
    }
    if (spendingError) {
      this.log.warn(`[fetchContext] Spending error: ${spendingError.message}`);
    }
    if (goalsError) {
      this.log.warn(`[fetchContext] Goals error: ${goalsError.message}`);
    }
    if (categoriesError) {
      this.log.warn(
        `[fetchContext] Categories error: ${categoriesError.message}`,
      );
    }

    // Use nickname if available, otherwise fall back to full_name
    const displayName = profile?.nickname ?? profile?.full_name ?? null;

    return {
      userId,
      displayName,
      personality: personality
        ? {
            tone: personality.tone ?? null,
            intensity: personality.intensity ?? null,
            mood: personality.mood ?? null,
          }
        : null,
      prefs: {
        timezone: profile?.timezone ?? null,
        locale: profile?.locale ?? null,
        notificationLevel: prefs?.notification_level ?? null,
        unifiedBalance: prefs?.unified_balance ?? null,
      },
      // All active budgets
      activeBudgets: (spending ?? [])
        .filter((s: { period: string; amount: number }) => s.period && s.amount)
        .map((s: { period: string; amount: number }) => ({
          period: s.period,
          amount: s.amount,
          spent: null,
        })),
      // Legacy: first budget for backwards compatibility
      activeBudget: spending?.[0]
        ? {
            period: spending[0].period ?? null,
            amount: spending[0].amount ?? null,
            spent: null,
          }
        : null,
      goalsCount: goals?.length ?? 0,
      goalsSummary: [],
      categories:
        categories?.map((c: { id: string; name: string }) => ({
          id: c.id,
          name: c.name,
        })) ?? [],
    };
  }
}
