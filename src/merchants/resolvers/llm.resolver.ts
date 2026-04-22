import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  LayerResolver,
  ResolverInput,
  ResolverOutput,
} from '../contracts/resolver.types';
import { isTransferDescription } from '../utils/string-normalizer';
import { EmbeddingResolver } from './embedding.resolver';

const LLM_MODEL = 'gemini-2.5-flash';

const CATEGORIES = [
  'Alimentación',
  'Supermercado',
  'Delivery',
  'Transporte',
  'Bencina',
  'Café',
  'Comida rápida',
  'Restaurante',
  'Suscripción',
  'Telefonía',
  'Internet',
  'Servicios',
  'Retail',
  'Hogar',
  'Salud',
  'Tecnología',
  'Otros',
] as const;

interface LlmParseResult {
  name: string;
  default_category: string;
  alias_observed: string;
}

/**
 * Layer 1d — LLM fallback.
 * When all previous layers miss, asks Gemini to parse the raw bank string
 * into a canonical merchant, then INSERTs it into merchants_global with
 * verified=false for admin review. Future hits of the same string fall
 * back to catalog/trgm (faster and free).
 */
@Injectable()
export class LlmResolver implements LayerResolver {
  readonly source = 'llm' as const;
  private readonly log = new Logger(LlmResolver.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    @Inject(EmbeddingResolver) private readonly embeddingResolver: EmbeddingResolver,
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
    if (isTransferDescription(input.rawDescription)) return null;

    let parsed: LlmParseResult | null;
    try {
      parsed = await this.parseWithLlm(input.rawDescription);
    } catch (err) {
      this.log.warn(
        `[llm] parse failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }

    if (!parsed) return null;

    // Generate embedding so future similar strings hit Layer 1c.
    let embedding: number[] | null = null;
    try {
      embedding = await this.embeddingResolver.embed(parsed.name);
    } catch (err) {
      this.log.warn(`[llm] embed failed: ${String(err)}`);
    }

    // Idempotent INSERT (name unique case-insensitive via index).
    const { data, error } = await this.supabase
      .from('merchants_global')
      .insert({
        name: parsed.name,
        aliases: parsed.alias_observed ? [parsed.alias_observed] : [],
        default_category: parsed.default_category,
        embedding: embedding ? (embedding as any) : null,
        verified: false,
      })
      .select('id, name, logo_url, default_category')
      .single();

    if (error) {
      // Race: another request just inserted this merchant. Fetch instead.
      if (error.code === '23505') {
        const existing = await this.supabase
          .from('merchants_global')
          .select('id, name, logo_url, default_category')
          .ilike('name', parsed.name)
          .limit(1)
          .maybeSingle();
        if (existing.data) {
          return {
            merchantId: existing.data.id,
            name: existing.data.name,
            logoUrl: existing.data.logo_url,
            defaultCategory: existing.data.default_category,
            source: 'llm',
            created: false,
          };
        }
      }
      this.log.warn(`[llm] insert error: ${error.message}`);
      return null;
    }

    return {
      merchantId: data.id,
      name: data.name,
      logoUrl: data.logo_url,
      defaultCategory: data.default_category,
      source: 'llm',
      created: true,
    };
  }

  private async parseWithLlm(
    raw: string,
  ): Promise<LlmParseResult | null> {
    const model = this.genAI.getGenerativeModel({
      model: LLM_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });

    const prompt = `Eres un parser de transacciones bancarias chilenas.
Dado el siguiente string de una transacción, identifica el comercio (merchant).

INPUT: "${raw.replace(/"/g, '\\"')}"

Responde SOLO un JSON con esta forma:
{
  "name": "Nombre canónico del merchant (Title Case, sin sufijos .com/.cl, sin sucursal, sin dígitos)",
  "default_category": "Una de: ${CATEGORIES.join(', ')}",
  "alias_observed": "El string identificador del input en MAYÚSCULAS, sin fechas ni montos ni dígitos de transacción"
}

Si el string es una transferencia entre personas, retiro de efectivo, o no representa un comercio identificable, responde: null`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    if (!text || text === 'null') return null;

    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.name || typeof parsed.name !== 'string') return null;
      return {
        name: parsed.name.trim(),
        default_category:
          typeof parsed.default_category === 'string'
            ? parsed.default_category
            : 'Otros',
        alias_observed:
          typeof parsed.alias_observed === 'string'
            ? parsed.alias_observed.trim().toUpperCase()
            : '',
      };
    } catch {
      this.log.warn(`[llm] invalid json: ${text.slice(0, 200)}`);
      return null;
    }
  }
}
