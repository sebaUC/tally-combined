import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class UsersService {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async getMe(userId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw new Error(error.message);
    return data;
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

  async getContext(userId: string) {
    const [
      { data: profile, error: profileError },
      { data: personality, error: personalityError },
      { data: goals, error: goalsError },
      { data: prefs, error: prefsError },
      { data: spending, error: spendingError },
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
    ]);

    if (profileError) throw new Error(profileError.message);
    if (personalityError) throw new Error(personalityError.message);
    if (goalsError) throw new Error(goalsError.message);
    if (prefsError) throw new Error(prefsError.message);
    if (spendingError) throw new Error(spendingError.message);

    return {
      profile,
      personality,
      goals: goals ?? [],
      prefs,
      activeBudget: spending,
    };
  }
}
