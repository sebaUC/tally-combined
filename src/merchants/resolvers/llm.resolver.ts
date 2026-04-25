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

// gemini-1.5-flash was retired from v1beta; use 2.5-flash (the same model the
// main bot uses successfully). The free-tier quota is shared across the key.
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
      // Name collision: merchant already exists (unique index on LOWER(name)).
      // Fetch the existing row and accumulate our alias so future syncs hit
      // Layer 1a (exact catalog match) instead of falling through to LLM again.
      if (error.code === '23505') {
        const existing = await this.supabase
          .from('merchants_global')
          .select('id, name, logo_url, default_category, aliases')
          .ilike('name', parsed.name)
          .limit(1)
          .maybeSingle();

        if (existing.data) {
          // Append alias if not already stored. Fire-and-forget — non-critical.
          if (parsed.alias_observed) {
            const current = (existing.data.aliases as string[]) ?? [];
            if (!current.includes(parsed.alias_observed)) {
              void this.supabase
                .from('merchants_global')
                .update({ aliases: [...current, parsed.alias_observed] })
                .eq('id', existing.data.id)
                .then(({ error: updErr }) => {
                  if (updErr) {
                    this.log.warn(`[llm] alias append failed id=${existing.data!.id}: ${updErr.message}`);
                  } else {
                    this.log.debug(`[llm] alias appended merchant="${existing.data!.name}" alias="${parsed.alias_observed}"`);
                  }
                });
            }
          }

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

    const prompt = `Eres un experto en transacciones bancarias chilenas. Identifica el COMERCIO (merchant) en la descripción que genera el banco.

CONTEXTO:
- Los bancos truncan las descripciones a ~20-30 caracteres en MAYÚSCULAS, incluyen ruido (fechas, sucursales, prefijos del banco).
- Debes inferir el nombre canónico aunque esté truncado, mal escrito, o con sufijo de sucursal.
- La SUCURSAL o EDIFICIO (Las Condes, Titanium, Apoquindo, Kennedy, etc.) NO forma parte del nombre del comercio.

FORMATOS TÍPICOS POR BANCO:
- BICE / Itaú: "Cargo por compra en NOMBRE SUCURSAL el..."
- BancoEstado: "COMPRA NAC 05/04 NOMBRE SUCURSAL"
- Santander: "Pago Vd NOMBRE.COM"

MERCHANTS CHILENOS COMUNES Y SUS TRUNCACIONES BANCARIAS:
- "WORK CAFE TITANIU", "WORK CAFE APOQUIN", "WORK CAFE KENNEDY" → Work Cafe Santander (son sucursales del coworking de Santander)
- "BROWNIE REP", "BROWNIE REPUB"   → Brownie Republic
- "MCDONALDS", "MC DONALDS"        → McDonald's
- "STARBUCKS", "STARBCK"           → Starbucks
- "UBER EATS", "UBEREATS"          → Uber Eats
- "RAPPI", "RAPPI CHILE"           → Rappi
- "CORNERSHOP"                     → Cornershop
- "COPEC", "COPEC S.A."            → Copec
- "NETFLIX.COM", "NETFLIX"         → Netflix
- "SPOTIFY"                        → Spotify
- "AMZN", "AMAZON"                 → Amazon
- "MERCADOPAGO*", "MERPAGO*"       → Mercado Pago
- "HOMECENTER", "SODIMAC HOME"     → Sodimac Homecenter
- "PREUNIC", "FARMACIAS PR"        → PreUnic
- "SALCOBRAND"                     → Salcobrand
- "CRUZ VERDE"                     → Cruz Verde
- "FARMACIAS A"                    → Farmacias Ahumada
- "SM MARKET", "SMU"               → SM Market
- "CAFETERIA TAKE", "CAFE TAKE GO" → Take Go

REGLAS:
1. Elimina el prefijo bancario ("Cargo por compra en", "COMPRA NAC 05/04 ", etc.) y la sucursal/ciudad del nombre.
2. Si el nombre está truncado, completa el nombre comercial correcto (ej: "TITANIU" → el edificio Titanium de Santiago → sucursal de Work Cafe Santander).
3. alias_observed = el fragmento que identifica al comercio TAL COMO APARECE en el input (MAYÚSCULAS, sin fechas, sin montos). Debe ser el string exacto del banco, no la versión corregida.
4. Retorna null si es: transferencia entre personas, retiro ATM, cargo bancario sin comercio, pago de dividendo, o string genérico sin comercio identificable (ej: "Comercio Nac.").

INPUT: "${raw.replace(/"/g, '\\"')}"

Responde SOLO un JSON (sin markdown, sin bloques de código):
{
  "name": "Nombre canónico en Title Case",
  "default_category": "Una de: ${CATEGORIES.join(', ')}",
  "alias_observed": "FRAGMENTO EXACTO DEL INPUT QUE IDENTIFICA AL COMERCIO"
}`;

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
