import { SupabaseClient } from '@supabase/supabase-js';

interface ResolveArgs {
  transaction_id?: string;
  hint_amount?: number;
  hint_category?: string;
  hint_name?: string;
}

const TX_SELECT =
  'id, amount, type, name, description, posted_at, account_id, category_id, merchant_id, categories:category_id(name)';

/**
 * Resolve a transaction by ID or hints (amount, category, name).
 * Returns a single match, an array of matches (ambiguous), or null.
 */
export async function resolveTransaction(
  supabase: SupabaseClient,
  userId: string,
  args: ResolveArgs,
) {
  // By ID
  if (args.transaction_id) {
    const { data } = await supabase
      .from('transactions')
      .select(TX_SELECT)
      .eq('id', args.transaction_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (data)
      return {
        ...data,
        cat_name: (data as any).categories?.name,
        amount: Number(data.amount),
      };
    return null;
  }

  // By hints or most recent
  const query = supabase
    .from('transactions')
    .select(TX_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data } = await query;
  if (!data?.length) return null;

  let matches = data.map((d: any) => ({
    ...d,
    cat_name: d.categories?.name,
    amount: Number(d.amount),
  }));

  if (args.hint_amount) {
    const target = args.hint_amount;
    const filtered = matches.filter(
      (m: any) => Math.abs(m.amount - target) / target < 0.05,
    );
    if (filtered.length) matches = filtered;
  }
  if (args.hint_category) {
    const cat = args.hint_category.toLowerCase();
    const filtered = matches.filter((m: any) =>
      m.cat_name?.toLowerCase().includes(cat),
    );
    if (filtered.length) matches = filtered;
  }
  if (args.hint_name) {
    const name = args.hint_name.toLowerCase();
    const filtered = matches.filter((m: any) =>
      m.name?.toLowerCase().includes(name),
    );
    if (filtered.length) matches = filtered;
  }

  if (matches.length === 1) return matches[0];
  if (
    matches.length > 1 &&
    !args.hint_amount &&
    !args.hint_category &&
    !args.hint_name
  ) {
    return matches[0]; // Most recent
  }
  if (matches.length > 3) return matches.slice(0, 5);
  return matches.length > 1 ? matches : matches[0] || null;
}
