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
// `gemini-embedding-001` returns 3072 dims by default; we force 768 via
// `outputDimensionality` to match the pgvector(768) schema in merchants_global.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMS = 768;

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
   * Generate a 768-dim embedding via Gemini.
   * Exposed for reuse by LlmResolver when seeding new merchants.
   */
  async embed(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent({
      content: { role: 'user', parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIMS,
    } as any);
    return result.embedding.values;
  }
}
