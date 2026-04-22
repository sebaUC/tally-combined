import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

const DEFAULT_THRESHOLD = 0.85;
// embedding-001 is the 768-dim Gemini embedding model exposed on v1beta
// (matches our vector(768) schema). Same quality tier as text-embedding-004
// which lives on v1 and is not reachable from @google/generative-ai@0.24.
const EMBEDDING_MODEL = 'embedding-001';

/**
 * Layer 1c — pgvector cosine similarity over merchants_global.embedding.
 * Generates a 768-dim embedding of the cleaned candidate with Gemini,
 * then calls `match_merchant_embedding` RPC. See migration 005.
 */
@Injectable()
export class EmbeddingResolver implements LayerResolver {
  readonly source = 'embedding' as const;
  private readonly log = new Logger(EmbeddingResolver.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const apiKey = config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async resolve(
    input: ResolverInput,
  ): Promise<Omit<ResolverOutput, 'latencyMs'> | null> {
    const candidate =
      extractMerchantCandidate(input.rawDescription) ?? input.rawDescription;
    const cleaned = cleanMerchantName(stripDomainSuffix(candidate));

    if (cleaned.length < 3) return null;

    let embedding: number[];
    try {
      embedding = await this.embed(cleaned);
    } catch (err) {
      this.log.warn(
        `[embedding] embed failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }

    const { data, error } = await this.supabase.rpc(
      'match_merchant_embedding',
      {
        query_embedding: embedding as any,
        threshold: DEFAULT_THRESHOLD,
      },
    );

    if (error) {
      this.log.warn(`[embedding] rpc error: ${error.message}`);
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
      source: 'embedding',
    };
  }

  /**
   * Generate a 768-dim embedding via Gemini's text-embedding-004.
   * Exposed for reuse by LlmResolver when seeding new merchants.
   */
  async embed(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }
}
