import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  LayerResolver,
  ResolverInput,
  ResolverOutput,
} from '../contracts/resolver.types';
import { extractMerchantCandidate } from '../utils/bank-patterns';
import {
  cleanMerchantName,
  stripDomainSuffix,
} from '../utils/string-normalizer';

const DEFAULT_THRESHOLD = 0.5;

/**
 * Layer 1b — pg_trgm fuzzy similarity over merchants_global.name.
 * Delegates to the `match_merchant_trgm` RPC because PostgREST does not
 * expose the `%` operator directly. See migration 005.
 */
@Injectable()
export class TrgmResolver implements LayerResolver {
  readonly source = 'trgm' as const;
  private readonly log = new Logger(TrgmResolver.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  async resolve(
    input: ResolverInput,
  ): Promise<Omit<ResolverOutput, 'latencyMs'> | null> {
    const candidate =
      extractMerchantCandidate(input.rawDescription) ?? input.rawDescription;
    const cleaned = cleanMerchantName(stripDomainSuffix(candidate));

    if (cleaned.length < 3) return null;

    const { data, error } = await this.supabase.rpc('match_merchant_trgm', {
      query_text: cleaned,
      threshold: DEFAULT_THRESHOLD,
    });

    if (error) {
      this.log.warn(`[trgm] rpc error: ${error.message}`);
      return null;
    }

    const row = (data ?? [])[0] as
      | {
          id: string;
          name: string;
          logo_url: string | null;
          default_category: string | null;
          similarity_score: number;
        }
      | undefined;

    if (!row) return null;

    return {
      merchantId: row.id,
      name: row.name,
      logoUrl: row.logo_url,
      defaultCategory: row.default_category,
      source: 'trgm',
    };
  }
}
