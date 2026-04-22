import { SupabaseClient } from '@supabase/supabase-js';

/**
 * set_balance — Update account balance directly.
 * Used when user says "tengo 500 mil en mi cuenta".
 * Does NOT create a transaction — just updates the balance.
 */
export async function setBalance(
  supabase: SupabaseClient,
  userId: string,
  args: {
    amount: number;
    account_name?: string;
  },
): Promise<Record<string, any>> {
  const { amount } = args;

  if (typeof amount !== 'number' || amount < 0 || amount >= 1_000_000_000) {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'Monto inválido.' };
  }

  // Find account — by name or first available
  let accountQuery = supabase
    .from('accounts')
    .select('id, name, current_balance')
    .eq('user_id', userId);

  if (args.account_name) {
    accountQuery = accountQuery.ilike('name', args.account_name);
  }

  const { data: accounts } = await accountQuery.limit(1);
  const account = accounts?.[0];

  if (!account) {
    return {
      ok: false,
      error: 'NO_ACCOUNT',
      message: 'No tienes cuentas configuradas.',
    };
  }

  const previousBalance = Number(account.current_balance);

  const { error } = await supabase
    .from('accounts')
    .update({ current_balance: amount })
    .eq('id', account.id)
    .eq('user_id', userId);

  if (error) return { ok: false, error: 'DB_ERROR', message: error.message };

  return {
    ok: true,
    data: {
      amount,
      previousBalance,
      account: account.name,
    },
  };
}
