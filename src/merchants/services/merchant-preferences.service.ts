import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * user_merchant_preferences — per-user learned category for a given merchant.
 *
 * Flow:
 *   - resolver pipeline finds merchant_id
 *   - this service looks up the user's preferred category_id for that merchant
 *   - if present, overrides the merchant's default_category
 *   - when the user confirms/edits a transaction category, upsert is called
 */
@Injectable()
export class MerchantPreferencesService {
  private readonly log = new Logger(MerchantPreferencesService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Returns the category_id this user prefers for this merchant, or null.
   */
  async getCategoryFor(
    userId: string,
    merchantId: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('user_merchant_preferences')
      .select('category_id')
      .eq('user_id', userId)
      .eq('merchant_id', merchantId)
      .maybeSingle();

    if (error) {
      this.log.warn(`[prefs] lookup error: ${error.message}`);
      return null;
    }

    return data?.category_id ?? null;
  }

  /**
   * Records that this user classifies this merchant into this category.
   * Called when the user confirms or edits the category of a transaction.
   * Bumps times_used and touches last_used_at.
   */
  async upsert(
    userId: string,
    merchantId: string,
    categoryId: string,
  ): Promise<void> {
    // Upsert via primary key (user_id, merchant_id). If it existed with a
    // different category, we overwrite — the latest edit wins.
    const { error } = await this.supabase.from('user_merchant_preferences').upsert(
      {
        user_id: userId,
        merchant_id: merchantId,
        category_id: categoryId,
        times_used: 1,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,merchant_id', ignoreDuplicates: false },
    );

    if (error) {
      this.log.warn(`[prefs] upsert error: ${error.message}`);
    }
  }
}
