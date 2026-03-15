import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class UsersService {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async getMe(userId: string) {
    const [{ data, error }, authResult] = await Promise.all([
      this.supabase.from('users').select('*').eq('id', userId).single(),
      this.supabase.auth.admin.getUserById(userId).catch(() => null),
    ]);

    if (error) throw new Error(error.message);

    // Merge auth metadata (age, nickname) into response
    const metadata = authResult?.data?.user?.user_metadata || {};
    return {
      ...data,
      age: metadata.age || null,
      auth_nickname: metadata.nickname || null,
    };
  }

  async updatePersona(
    userId: string,
    patch: Partial<{
      tone: string;
      intensity: number;
      mood: string;
    }>,
  ) {
    const { data, error } = await this.supabase
      .from('personality_snapshot')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updatePrefs(
    userId: string,
    patch: Partial<{ notification_level: string }>,
  ) {
    const { data, error } = await this.supabase
      .from('user_prefs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateProfile(
    userId: string,
    patch: Partial<{
      full_name: string;
      nickname: string;
      age: number;
    }>,
  ) {
    const now = new Date().toISOString();
    const tablePatch: Record<string, any> = { updated_at: now };
    const metadataPatch: Record<string, any> = {};

    if (patch.full_name !== undefined) {
      tablePatch.full_name = patch.full_name;
      metadataPatch.full_name = patch.full_name;
    }
    if (patch.nickname !== undefined) {
      tablePatch.nickname = patch.nickname;
      metadataPatch.nickname = patch.nickname;
    }
    if (patch.age !== undefined) {
      metadataPatch.age = patch.age;
    }

    // Update public.users table
    const { data, error } = await this.supabase
      .from('users')
      .update(tablePatch)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Sync metadata to auth.users (non-blocking)
    if (Object.keys(metadataPatch).length > 0) {
      await this.supabase.auth.admin.updateUserById(userId, {
        user_metadata: metadataPatch,
      }).catch(() => { /* best-effort sync */ });
    }

    return { ...data, age: patch.age };
  }

  async getTransactions(userId: string, limit = 50) {
    // Fetch transactions with joined category and payment method names
    const { data, error } = await this.supabase
      .from('transactions')
      .select(
        `
        id,
        amount,
        category_id,
        posted_at,
        description,
        source,
        status,
        created_at,
        type,
        name,
        account_id,
        categories:category_id ( id, name ),
        accounts:account_id ( id, name, current_balance )
      `,
      )
      .eq('user_id', userId)
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getContext(userId: string) {
    const [
      { data: profile, error: profileError },
      { data: personality, error: personalityError },
      { data: goals, error: goalsError },
      { data: prefs, error: prefsError },
      { data: spending, error: spendingError },
      authResult,
    ] = await Promise.all([
      this.supabase.from('users').select('*').eq('id', userId).single(),
      this.supabase
        .from('personality_snapshot')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
      this.supabase.from('goals').select('*').eq('user_id', userId),
      this.supabase
        .from('user_prefs')
        .select('*')
        .eq('id', userId)
        .maybeSingle(),
      this.supabase
        .from('spending_expectations')
        .select('*')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle(),
      this.supabase.auth.admin.getUserById(userId).catch(() => null),
    ]);

    if (profileError) throw new Error(profileError.message);
    if (personalityError) throw new Error(personalityError.message);
    if (goalsError) throw new Error(goalsError.message);
    if (prefsError) throw new Error(prefsError.message);
    if (spendingError) throw new Error(spendingError.message);

    // Merge auth metadata into profile (full_name fallback, age, nickname)
    const metadata = authResult?.data?.user?.user_metadata || {};
    const mergedProfile = {
      ...profile,
      full_name: profile?.full_name || metadata.full_name || null,
      email: profile?.email || authResult?.data?.user?.email || null,
      nickname: profile?.nickname || metadata.nickname || null,
      age: metadata.age || null,
    };

    return {
      profile: mergedProfile,
      personality,
      goals: goals ?? [],
      prefs,
      activeBudget: spending,
    };
  }
}
