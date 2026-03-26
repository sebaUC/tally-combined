import { SupabaseClient } from '@supabase/supabase-js';

export async function editTransaction(
  supabase: SupabaseClient,
  userId: string,
  args: {
    transaction_id?: string;
    hint_amount?: number;
    hint_category?: string;
    hint_name?: string;
    new_amount?: number;
    new_category?: string;
    new_name?: string;
    new_description?: string;
    new_posted_at?: string;
  },
): Promise<Record<string, any>> {
  const {
    new_amount, new_category, new_name, new_description, new_posted_at,
  } = args;

  // Must have at least one change
  if (!new_amount && !new_category && !new_name && !new_description && !new_posted_at) {
    return { ok: false, error: 'NO_CHANGES', message: 'No se indicó qué cambiar.' };
  }

  // 1. Find the transaction
  const tx = await resolveTransaction(supabase, userId, args);
  if (!tx) {
    return { ok: false, error: 'NOT_FOUND', message: 'No encontré la transacción.' };
  }
  if (Array.isArray(tx)) {
    return { ok: false, error: 'MULTIPLE_MATCHES', matches: tx };
  }

  // 2. Build update payload
  const updates: Record<string, any> = {};
  const previous: Record<string, any> = {};

  if (new_amount !== undefined) {
    previous.amount = tx.amount;
    updates.amount = new_amount;
  }

  if (new_name) {
    previous.name = tx.name;
    updates.name = new_name;
  }

  if (new_description !== undefined) {
    previous.description = tx.description;
    updates.description = new_description;
  }

  if (new_posted_at) {
    previous.posted_at = tx.posted_at;
    updates.posted_at = new_posted_at;
  }

  // 3. Resolve new category
  if (new_category) {
    const { data: cat } = await supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', new_category)
      .maybeSingle();

    if (!cat) {
      // Substring match
      const { data: cats } = await supabase
        .from('categories')
        .select('id, name')
        .eq('user_id', userId);

      const match = (cats || []).find((c: any) =>
        c.name.toLowerCase().includes(new_category.toLowerCase()) ||
        new_category.toLowerCase().includes(c.name.toLowerCase()),
      );

      if (!match) {
        return {
          ok: false,
          error: 'CATEGORY_NOT_FOUND',
          message: `No encontré la categoría "${new_category}".`,
          available: (cats || []).map((c: any) => c.name),
        };
      }

      previous.category = tx.cat_name;
      updates.category_id = match.id;
    } else {
      previous.category = tx.cat_name;
      updates.category_id = cat.id;
    }
  }

  // 4. Update transaction
  const { error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', tx.id)
    .eq('user_id', userId);

  if (error) return { ok: false, error: 'DB_ERROR', message: error.message };

  // 5. Adjust account balance if amount changed
  if (new_amount !== undefined && tx.account_id) {
    const oldAmount = tx.type === 'income' ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    const newAmount = tx.type === 'income' ? Math.abs(new_amount) : -Math.abs(new_amount);
    const delta = newAmount - oldAmount;
    if (delta !== 0) {
      await supabase.rpc('update_account_balance', { p_account_id: tx.account_id, p_delta: delta });
    }
  }

  return {
    ok: true,
    data: {
      id: tx.id,
      previous,
      updated: {
        ...updates,
        category: new_category || tx.cat_name,
      },
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
      .select('id, amount, type, name, description, posted_at, account_id, category_id, categories:category_id(name)')
      .eq('id', args.transaction_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return { ...data, cat_name: (data as any).categories?.name, amount: Number(data.amount) };
    return null;
  }

  // By hints or most recent
  let query = supabase
    .from('transactions')
    .select('id, amount, type, name, description, posted_at, account_id, category_id, categories:category_id(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data } = await query;
  if (!data?.length) return null;

  let matches = data.map((d: any) => ({
    ...d, cat_name: d.categories?.name, amount: Number(d.amount),
  }));

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
  if (matches.length > 3) return matches.slice(0, 5);
  return matches.length > 1 ? matches : matches[0] || null;
}
