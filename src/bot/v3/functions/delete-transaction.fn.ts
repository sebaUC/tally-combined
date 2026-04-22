import { SupabaseClient } from '@supabase/supabase-js';
import { resolveTransaction } from './shared';

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
    return {
      ok: false,
      error: 'NOT_FOUND',
      message: 'No encontré la transacción.',
    };
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
    const delta =
      tx.type === 'income' ? -Math.abs(tx.amount) : Math.abs(tx.amount);
    await supabase.rpc('update_account_balance', {
      p_account_id: tx.account_id,
      p_delta: delta,
    });
  }

  // 4. Reactive context: updated balance
  let accountBalance: number | undefined;
  if (tx.account_id) {
    const { data: acc } = await supabase
      .from('accounts')
      .select('current_balance')
      .eq('id', tx.account_id)
      .single();
    accountBalance = Math.round(Number(acc?.current_balance ?? 0));
  }

  return {
    ok: true,
    data: {
      deleted: {
        id: tx.id,
        amount: tx.amount,
        category: tx.cat_name ?? null,
        name: tx.name,
        type: tx.type,
      },
    },
    context: { accountBalance },
  };
}
