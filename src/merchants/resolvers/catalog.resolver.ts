import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  LayerResolver,
  ResolverInput,
  ResolverOutput,
} from '../contracts/resolver.types';

const DEFAULT_THRESHOLD = 0.85;
const MIN_INPUT_LENGTH = 3;

/**
 * Layer 1a — Catalog resolver.
 *
 * Finds merchants whose `name` or any `alias` appears as a word within the
 * raw bank description. Uses `word_similarity` (pg_trgm) via RPC, which is
 * the word-boundary equivalent of the old `\bword\b` regex approach but
 * index-backed.
 *
 * Examples (with "Lider" in merchants_global):
 *   "COMPRA NAC 05/04 LIDER PROVIDENCIA" → Lider (score ≈ 1.0)
 *   "Pago Vd LIDER"                       → Lider (score ≈ 1.0)
 *   "LIDEER"                              → null  (score ≈ 0.71 < 0.85)
 *                                            falls through to Layer 1b (trgm)
 *   "Jumbo Las Condes"                    → null  (score ≈ 0.14, far below)
 *
 * No pre-parsing of the raw string is needed — word_similarity handles the
 * "find the merchant inside the noise" case directly.
 */
@Injectable()
export class CatalogResolver implements LayerResolver {
  readonly source = 'catalog' as const;
  private readonly log = new Logger(CatalogResolver.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  async resolve(
    input: ResolverInput,
  ): Promise<Omit<ResolverOutput, 'latencyMs'> | null> {
    const raw = input.rawDescription?.trim() ?? '';
    if (raw.length < MIN_INPUT_LENGTH) return null;

    const { data, error } = await this.supabase.rpc(
      'match_merchant_word_trgm',
      {
        query_text: raw,
        threshold: DEFAULT_THRESHOLD,
      },
    );

    if (error) {
      this.log.warn(`[catalog] rpc error: ${error.message}`);
      return null;
    }

    const row = (data ?? [])[0] as
      | {
          id: string;
          name: string;
          logo_url: string | null;
          default_category: string | null;
          score: number;
        }
      | undefined;

    if (!row) return null;

    return {
      merchantId: row.id,
      name: row.name,
      logoUrl: row.logo_url,
      defaultCategory: row.default_category,
      source: 'catalog',
    };
  }
}
