import { SupabaseClient } from '@supabase/supabase-js';
import { pickCategoryEmoji } from './emoji-mapper.js';

/**
 * register_expense — Inserts an expense transaction.
 * Pure function: receives args, executes DB ops, returns result.
 */
export async function registerExpense(
  supabase: SupabaseClient,
  userId: string,
  args: {
    amount: number;
    category?: string;
    name?: string;
    posted_at?: string;
    description?: string;
  },
): Promise<Record<string, any>> {
  const { amount, description } = args;

  // Validate amount
  if (typeof amount !== 'number' || amount <= 0 || amount >= 100_000_000) {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'El monto debe ser mayor a 0 y menor a 100 millones.' };
  }

  const category = args.category || 'Sin categoría';
  const name = args.name || category;

  // Default date+time in Chile timezone with offset (so Supabase stores correctly)
  const postedAt = args.posted_at || getChileTimestamp();

  // 1. Match category
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, icon')
    .eq('user_id', userId);

  let matched = findCategory(category, categories || []);

  // Auto-create category if not found — algorithmic, no round-trip to Gemini
  if (!matched) {
    const icon = pickCategoryEmoji(category);
    const { data: created, error: createErr } = await supabase
      .from('categories')
      .insert({ user_id: userId, name: category, icon })
      .select('id, name')
      .single();

    if (createErr || !created) {
      return {
        ok: false,
        error: 'CATEGORY_CREATE_FAILED',
        message: `No pude crear la categoría "${category}".`,
      };
    }
    matched = created;
  }

  // 2. Get default account
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!account) {
    return { ok: false, error: 'NO_ACCOUNT' };
  }

  // 3. Insert transaction
  const { data: inserted, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      amount: Math.round(amount * 100) / 100,
      category_id: matched.id,
      posted_at: postedAt,
      description: description ?? null,
      account_id: account.id,
      source: 'chat_intent',
      status: 'posted',
      type: 'expense',
      name: name ?? null,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: 'DB_INSERT_FAILED', message: error.message };
  }

  // 4. Update account balance
  await supabase.rpc('update_account_balance', {
    p_account_id: account.id,
    p_delta: -Math.abs(amount),
  });

  // Check if category was just auto-created (not in original list)
  const wasAutoCreated = !(categories || []).some(
    (c) => c.id === matched!.id,
  );

  return {
    ok: true,
    data: {
      id: inserted?.id,
      amount: Math.round(amount * 100) / 100,
      category: matched!.name,
      icon: matched!.icon || null,
      name,
      posted_at: postedAt,
      description: description ?? null,
      ...(wasAutoCreated ? { categoryCreated: true } : {}),
    },
  };
}

// ── Category matching (exact → substring → typo tolerance) ──

function findCategory(
  input: string,
  categories: { id: string; name: string; icon?: string }[],
): { id: string; name: string; icon?: string } | null {
  if (!input || !categories.length) return null;
  const lower = input.toLowerCase().trim();

  // Exact (case-insensitive)
  const exact = categories.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;

  // Substring
  const partial = categories.find((c) => {
    const cl = c.name.toLowerCase();
    return cl.includes(lower) || lower.includes(cl);
  });
  if (partial) return partial;

  // Typo tolerance (2-char diff)
  const typo = categories.find((c) => isSimilar(lower, c.name.toLowerCase(), 2));
  if (typo) return typo;

  return null;
}

function isSimilar(a: string, b: string, maxDiff: number): boolean {
  if (Math.abs(a.length - b.length) > maxDiff) return false;
  let diff = 0;
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) diff++;
    if (diff > maxDiff) return false;
  }
  return diff + Math.abs(a.length - b.length) <= maxDiff;
}

/** Chile timestamp with timezone offset (e.g. 2026-03-26T17:30:00-03:00) */
function getChileTimestamp(): string {
  const d = new Date();
  const local = d.toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).replace(' ', 'T');
  const parts = d.toLocaleString('en-US', { timeZone: 'America/Santiago', timeZoneName: 'shortOffset' });
  const offset = parts.match(/GMT([+-]\d+)/)?.[1] || '-3';
  const hours = parseInt(offset);
  const offsetStr = (hours < 0 ? '-' : '+') + String(Math.abs(hours)).padStart(2, '0') + ':00';
  return local + offsetStr;
}
