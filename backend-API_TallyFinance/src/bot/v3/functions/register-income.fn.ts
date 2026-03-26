import { SupabaseClient } from '@supabase/supabase-js';

export async function registerIncome(
  supabase: SupabaseClient,
  userId: string,
  args: {
    amount: number;
    source?: string;
    posted_at?: string;
    description?: string;
    recurring?: boolean;
    period?: string;
  },
): Promise<Record<string, any>> {
  const { amount, description } = args;

  // Validate amount
  if (typeof amount !== 'number' || amount <= 0 || amount >= 100_000_000) {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'El monto debe ser mayor a 0 y menor a 100 millones.' };
  }

  const source = args.source || 'Ingreso';
  const postedAt =
    args.posted_at ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

  // Get default account
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!account) {
    return { ok: false, error: 'NO_ACCOUNT' };
  }

  // Try to match an existing income_expectation by name/source
  let incomeExpId: string | null = null;
  const { data: expectations } = await supabase
    .from('income_expectations')
    .select('id, name, source, period, amount')
    .eq('user_id', userId)
    .eq('active', true);

  if (expectations?.length) {
    const sourceLower = source.toLowerCase();
    // Match by name or source (case-insensitive, substring)
    const matched = expectations.find((e) => {
      const eName = (e.name || '').toLowerCase();
      const eSource = (e.source || '').toLowerCase();
      return (
        eName === sourceLower ||
        eSource === sourceLower ||
        sourceLower.includes(eName) ||
        eName.includes(sourceLower) ||
        sourceLower.includes(eSource) ||
        eSource.includes(sourceLower)
      );
    });
    if (matched) incomeExpId = matched.id;
  }

  // If recurring and no matching expectation exists, create one
  if (args.recurring && !incomeExpId) {
    const { data: newExp } = await supabase
      .from('income_expectations')
      .insert({
        user_id: userId,
        name: source,
        source: source,
        description: description ?? null,
        period: args.period || 'monthly',
        amount: Math.round(amount * 100) / 100,
        pay_day: new Date(postedAt).getDate().toString(),
        active: true,
      })
      .select('id')
      .single();

    if (newExp) incomeExpId = newExp.id;
  }

  // Insert income transaction linked to expectation
  const { data: inserted, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      amount: Math.round(amount * 100) / 100,
      category_id: null,
      posted_at: postedAt,
      account_id: account.id,
      source: 'chat_intent',
      status: 'posted',
      type: 'income',
      name: source,
      description: description ?? null,
      income_expectation_id: incomeExpId,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: 'DB_INSERT_FAILED', message: error.message };
  }

  // Update account balance
  await supabase.rpc('update_account_balance', {
    p_account_id: account.id,
    p_delta: Math.abs(amount),
  });

  return {
    ok: true,
    data: {
      id: inserted?.id,
      amount: Math.round(amount * 100) / 100,
      source,
      type: 'income',
      posted_at: postedAt,
      description: description ?? null,
      linked_to_expectation: !!incomeExpId,
      recurring: args.recurring ?? false,
    },
  };
}
