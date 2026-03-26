import { SupabaseClient } from '@supabase/supabase-js';

export async function deleteTransaction(
  supabase: SupabaseClient,
  userId: string,
  args: {
    transaction_id?: string;
    hint_amount?: number;
    hint_category?: string;
    hint_name?: string;
  },
): Promise<Record<string, any>> {
  // 1. Find the transaction
  const tx = await resolveTransaction(supabase, userId, args);
  if (!tx) {
    return { ok: false, error: 'NOT_FOUND', message: 'No encontré la transacción.' };
  }
  if (Array.isArray(tx)) {
    return { ok: false, error: 'MULTIPLE_MATCHES', matches: tx };
  }

  // 2. Delete
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', tx.id)
    .eq('user_id', userId);

  if (error) return { ok: false, error: 'DB_ERROR', message: error.message };

  // 3. Revert account balance
  if (tx.account_id) {
    const delta = tx.type === 'income' ? -Math.abs(tx.amount) : Math.abs(tx.amount);
    await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: delta });
  }

  return {
    ok: true,
    data: {
      deleted: { id: tx.id, amount: tx.amount, category: tx.cat_name ?? null, name: tx.name, type: tx.type },
    },
  };
}

async function resolveTransaction(
  supabase: SupabaseClient,
  userId: string,
  args: { transaction_id?: string; hint_amount?: number; hint_category?: string; hint_name?: string },
) {
  // By ID
  if (args.transaction_id) {
    const { data } = await supabase
      .from('transactions')
      .select('id, amount, type, name, account_id, category_id, categories:category_id(name)')
      .eq('id', args.transaction_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return { ...data, cat_name: (data as any).categories?.name, amount: Number(data.amount) };
    return null;
  }

  // By hints or most recent
  let query = supabase
    .from('transactions')
    .select('id, amount, type, name, account_id, category_id, posted_at, categories:category_id(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data } = await query;
  if (!data?.length) return null;

  let matches = data.map((d: any) => ({
    ...d, cat_name: d.categories?.name, amount: Number(d.amount),
  }));

  // Filter by hints
  if (args.hint_amount) {
    const target = args.hint_amount;
    const filtered = matches.filter((m: any) => Math.abs(m.amount - target) / target < 0.05);
    if (filtered.length) matches = filtered;
  }
  if (args.hint_category) {
    const cat = args.hint_category.toLowerCase();
    const filtered = matches.filter((m: any) => m.cat_name?.toLowerCase().includes(cat));
    if (filtered.length) matches = filtered;
  }
  if (args.hint_name) {
    const name = args.hint_name.toLowerCase();
    const filtered = matches.filter((m: any) => m.name?.toLowerCase().includes(name));
    if (filtered.length) matches = filtered;
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && !args.hint_amount && !args.hint_category && !args.hint_name) {
    return matches[0]; // Most recent
  }
  if (matches.length > 3) return matches.slice(0, 5); // Too many — return list
  return matches.length > 1 ? matches : matches[0] || null;
}
