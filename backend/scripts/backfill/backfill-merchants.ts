/**
 * Backfill de merchant_id / merchant_name / resolver_source para transacciones
 * viejas donde estas columnas quedaron NULL (pre-resolver deploy).
 *
 * Procesa en lotes de 200 filas, respeta cursor por `id` para reanudar si
 * se interrumpe. Fire-and-forget a fintoc_access_log con stats por lote.
 *
 *   npx tsx scripts/backfill/backfill-merchants.ts [--dry-run] [--limit=N] [--source=bank_api|chat_intent]
 *
 * Por defecto: procesa 2000 filas de source='bank_api' con resolver_source IS NULL.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';

import { SupabaseModule } from '../../src/supabase/supabase.module';
import { MerchantsModule } from '../../src/merchants/merchants.module';
import { MerchantResolverService } from '../../src/merchants/services/merchant-resolver.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    MerchantsModule,
  ],
})
class BackfillModule {}

interface Args {
  dryRun: boolean;
  limit: number;
  source: string | null;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const args: Args = { dryRun: false, limit: 2000, source: 'bank_api' };
  for (const a of raw) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--limit=')) args.limit = Number(a.split('=')[1]) || 2000;
    else if (a.startsWith('--source=')) {
      const v = a.split('=')[1];
      args.source = v === 'any' ? null : v;
    }
  }
  return args;
}

interface TxRow {
  id: number;
  raw_description: string | null;
  description: string | null;
  name: string | null;
  source: string;
}

async function run() {
  const args = parseArgs();
  console.log(
    `\n› Backfill merchants — dryRun=${args.dryRun} limit=${args.limit} source=${args.source ?? 'any'}\n`,
  );

  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  });

  try {
    const supabase = app.get<SupabaseClient>('SUPABASE');
    const resolver = app.get(MerchantResolverService);

    // Fetch candidate rows in chunks of 200 (supabase .limit cap is 1000)
    const BATCH = 200;
    let processed = 0;
    let updated = 0;
    let noText = 0;
    let failed = 0;
    let lastId = 0;

    while (processed < args.limit) {
      let query = supabase
        .from('transactions')
        .select('id, raw_description, description, name, source')
        .is('resolver_source', null)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(Math.min(BATCH, args.limit - processed));

      if (args.source) query = query.eq('source', args.source);

      const { data, error } = await query;

      if (error) {
        console.error(`✗ fetch failed: ${error.message}`);
        break;
      }
      const rows = (data ?? []) as TxRow[];
      if (rows.length === 0) break;

      for (const row of rows) {
        processed++;
        lastId = row.id;

        const text =
          row.raw_description?.trim() ||
          row.description?.trim() ||
          row.name?.trim() ||
          '';
        if (!text) {
          noText++;
          continue;
        }

        try {
          const resolved = await resolver.resolve({ rawDescription: text });

          if (!args.dryRun) {
            const { error: upErr } = await supabase
              .from('transactions')
              .update({
                merchant_id: resolved.merchantId,
                merchant_name: resolved.name,
                resolver_source: resolved.source,
              })
              .eq('id', row.id);

            if (upErr) {
              failed++;
              console.warn(`  ✗ id=${row.id} update: ${upErr.message}`);
              continue;
            }
          }

          updated++;
          if (processed % 50 === 0) {
            console.log(
              `  · processed=${processed} updated=${updated} source_hit=${resolved.source} last_id=${lastId}`,
            );
          }
        } catch (err) {
          failed++;
          console.warn(
            `  ✗ id=${row.id} resolve: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // If the batch came back smaller than requested, the cursor is exhausted.
      if (rows.length < BATCH) break;
    }

    console.log(
      `\n› Done — processed=${processed} updated=${updated} no_text=${noText} failed=${failed} last_id=${lastId}\n`,
    );
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error('\n✗ Backfill crashed:', err);
  process.exit(1);
});
