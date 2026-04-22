import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ResolverInput,
  ResolverOutput,
} from '../contracts/resolver.types';
import { CatalogResolver } from '../resolvers/catalog.resolver';
import { TrgmResolver } from '../resolvers/trgm.resolver';
import { EmbeddingResolver } from '../resolvers/embedding.resolver';
import { LlmResolver } from '../resolvers/llm.resolver';
import {
  cleanMerchantName,
  isTransferDescription,
} from '../utils/string-normalizer';

/**
 * Layer 1 orchestrator — walks a raw bank description through the 4
 * resolution layers in cascade and stops at the first hit.
 *
 *   1a. CatalogResolver   — exact match in merchants_global (GIN)
 *   1b. TrgmResolver      — pg_trgm fuzzy on name
 *   1c. EmbeddingResolver — pgvector cosine on embedding
 *   1d. LlmResolver       — Gemini parse + insert new merchant
 *
 * If no layer hits, returns { merchantId: null, source: 'none' } with a
 * best-effort display name so the transaction still gets inserted cleanly.
 */
@Injectable()
export class MerchantResolverService {
  private readonly log = new Logger(MerchantResolverService.name);

  constructor(
    @Inject(CatalogResolver) private readonly catalogResolver: CatalogResolver,
    @Inject(TrgmResolver) private readonly trgmResolver: TrgmResolver,
    @Inject(EmbeddingResolver) private readonly embeddingResolver: EmbeddingResolver,
    @Inject(LlmResolver) private readonly llmResolver: LlmResolver,
  ) {}

  async resolve(input: ResolverInput): Promise<ResolverOutput> {
    const start = Date.now();
    const raw = input.rawDescription?.trim() ?? '';

    if (!raw) {
      return this.none(raw, start);
    }

    // Short-circuit: transfers between people have no merchant but are still
    // useful to group under a "Transferencia" category in the UI.
    if (isTransferDescription(raw)) {
      return {
        merchantId: null,
        name: 'Transferencia',
        logoUrl: null,
        defaultCategory: 'Transferencia',
        source: 'none',
        latencyMs: Date.now() - start,
      };
    }

    // Cascade: first layer to return a match wins.
    const layers = [
      this.catalogResolver,
      this.trgmResolver,
      this.embeddingResolver,
      this.llmResolver,
    ];

    for (const layer of layers) {
      try {
        const hit = await layer.resolve(input);
        if (hit) {
          const latencyMs = Date.now() - start;
          this.log.debug(
            `[resolver] hit source=${hit.source} merchant="${hit.name}" latency=${latencyMs}ms`,
          );
          return { ...hit, latencyMs };
        }
      } catch (err) {
        this.log.warn(
          `[resolver] layer=${layer.source} error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.none(raw, start);
  }

  private none(raw: string, startedAt: number): ResolverOutput {
    return {
      merchantId: null,
      name: cleanMerchantName(raw).slice(0, 40) || 'Transacción',
      logoUrl: null,
      defaultCategory: null,
      source: 'none',
      latencyMs: Date.now() - startedAt,
    };
  }
}
