/**
 * Seed inicial de merchants_global.
 *
 * Inserta 68 comercios chilenos comunes (CATALOG_CL) con:
 *   - name, default_category, aliases
 *   - logo_url vía Clearbit público (si hay website)
 *   - embedding 768-dim generado con Gemini
 *   - verified = true
 *
 * Idempotente: skip si ya existe un merchant con el mismo name (LOWER).
 *
 * Ejecución: npm run seed:merchants  (desde backend/)
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';

import { SupabaseModule } from '../../src/supabase/supabase.module';
import { MerchantsModule } from '../../src/merchants/merchants.module';
import { EmbeddingResolver } from '../../src/merchants/resolvers/embedding.resolver';
import { CATALOG_CL, SeedMerchant } from './catalog-cl';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    MerchantsModule,
  ],
})
class SeedModule {}

interface SeedStats {
  inserted: number;
  insertedWithoutEmbedding: number;
  skipped: number;
  failed: number;
  startedAt: number;
}

function buildLogoUrl(website?: string): string | null {
  if (!website) return null;
  const clean = website.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return `https://logo.clearbit.com/${clean}`;
}

function buildAliases(merchant: SeedMerchant): string[] {
  if (merchant.aliases && merchant.aliases.length > 0) {
    return [...new Set(merchant.aliases.map((a) => a.toUpperCase()))];
  }
  return [merchant.name.toUpperCase()];
}

async function seedOne(
  supabase: SupabaseClient,
  embedder: EmbeddingResolver,
  merchant: SeedMerchant,
  stats: SeedStats,
): Promise<void> {
  // Idempotencia: skip si ya existe (case-insensitive por unique index)
  const { data: existing, error: lookupErr } = await supabase
    .from('merchants_global')
    .select('id')
    .ilike('name', merchant.name)
    .maybeSingle();

  if (lookupErr) {
    console.warn(`  ✗ ${merchant.name}: lookup failed — ${lookupErr.message}`);
    stats.failed++;
    return;
  }

  if (existing) {
    stats.skipped++;
    return;
  }

  // Embedding is optional. If the API rejects the request (model access,
  // quota, etc.) we still insert the row with embedding=null — Layer 1a/1b
  // still work without it, Layer 1c simply won't return this merchant until
  // a later backfill pass populates the vector.
  let embedding: number[] | null = null;
  try {
    embedding = await embedder.embed(merchant.name);
  } catch (err) {
    console.warn(
      `  ! ${merchant.name}: embed skipped — ${err instanceof Error ? err.message.slice(0, 80) : err}`,
    );
  }

  const row = {
    name: merchant.name,
    aliases: buildAliases(merchant),
    default_category: merchant.default_category,
    logo_url: buildLogoUrl(merchant.website),
    embedding: embedding ? (embedding as unknown as string) : null,
    verified: true,
  };

  const { error: insertErr } = await supabase
    .from('merchants_global')
    .insert(row);

  if (insertErr) {
    console.warn(`  ✗ ${merchant.name}: insert failed — ${insertErr.message}`);
    stats.failed++;
    return;
  }

  stats.inserted++;
  if (!embedding) stats.insertedWithoutEmbedding++;
  console.log(
    `  ✓ ${merchant.name.padEnd(28)} [${merchant.default_category.padEnd(14)}] ${
      row.logo_url ? 'logo' : '—   '
    } ${embedding ? 'embed' : 'no-embed'}`,
  );
}

async function run() {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn'],
  });

  try {
    const supabase = app.get<SupabaseClient>('SUPABASE');
    const embedder = app.get(EmbeddingResolver);

    console.log(`\n› Seeding ${CATALOG_CL.length} merchants into merchants_global\n`);

    const stats: SeedStats = {
      inserted: 0,
      insertedWithoutEmbedding: 0,
      skipped: 0,
      failed: 0,
      startedAt: Date.now(),
    };

    for (const merchant of CATALOG_CL) {
      await seedOne(supabase, embedder, merchant, stats);
    }

    const elapsed = ((Date.now() - stats.startedAt) / 1000).toFixed(1);
    console.log(
      `\n› Done in ${elapsed}s — inserted=${stats.inserted} (without_embedding=${stats.insertedWithoutEmbedding}) skipped=${stats.skipped} failed=${stats.failed}\n`,
    );
    if (stats.insertedWithoutEmbedding > 0) {
      console.log(
        `  ℹ ${stats.insertedWithoutEmbedding} merchants inserted without embedding. ` +
          `Layer 1c (semantic) is disabled for these until embeddings are backfilled. ` +
          `Layers 1a/1b/1d still work.\n`,
      );
    }
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('\n✗ Seed crashed:', err);
  process.exit(1);
});
