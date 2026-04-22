import { SupabaseClient } from '@supabase/supabase-js';
import { getChileTimestamp } from './shared';
import type { FunctionRouterDeps } from '../function-deps.js';

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
  deps: FunctionRouterDeps = {},
): Promise<Record<string, any>> {
  const { amount, description } = args;

  // Validate amount
  if (typeof amount !== 'number' || amount <= 0 || amount >= 100_000_000) {
    return {
      ok: false,
      error: 'INVALID_AMOUNT',
      message: 'El monto debe ser mayor a 0 y menor a 100 millones.',
    };
  }

  const source = args.source || 'Ingreso';
  const postedAt = args.posted_at || getChileTimestamp();
  const rawDescription = description?.trim() || null;

  // Income rarely has a merchant, but we still run the resolver to keep the
  // pipeline uniform and to surface patterns like "Apple" giving a refund.
  // Best-effort — failures don't block the insert.
  const textToResolve = rawDescription || source;
  const resolved = textToResolve && deps.merchantResolver
    ? await deps.merchantResolver
        .resolve({ rawDescription: textToResolve })
        .catch(() => null)
    : null;

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
      raw_description: rawDescription,
      merchant_id: resolved?.merchantId ?? null,
      merchant_name: resolved?.name ?? null,
      resolver_source: resolved?.source ?? null,
      auto_categorized: false,
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

  // Reactive context: balance + budget headroom after income
  const context = await computePostIncomeContext(supabase, userId, account.id);

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
    context,
  };
}

async function computePostIncomeContext(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
): Promise<Record<string, any>> {
  const now = new Date();
  const todayStr = now.toLocaleDateString('sv-SE', {
    timeZone: 'America/Santiago',
  });
  const [y, m] = todayStr.split('-');
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const monthStart = `${y}-${m}-01T00:00:00`;
  const monthEnd = `${y}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59`;

  const [{ data: accountData }, { data: monthExpenses }, { data: budgets }] =
    await Promise.all([
      supabase
        .from('accounts')
        .select('current_balance')
        .eq('id', accountId)
        .single(),
      supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('type', 'expense')
        .gte('posted_at', monthStart)
        .lte('posted_at', monthEnd),
      supabase
        .from('spending_expectations')
        .select('period, amount')
        .eq('user_id', userId)
        .eq('active', true),
    ]);

  const balance = Math.round(Number(accountData?.current_balance ?? 0));
  const monthTotal = (monthExpenses || []).reduce(
    (s: number, t: any) => s + Number(t.amount),
    0,
  );

  const ctx: Record<string, any> = { accountBalance: balance };

  const monthly = (budgets || []).find((b: any) => b.period === 'monthly');
  if (monthly && monthly.amount > 0) {
    const limit = Number(monthly.amount);
    ctx.budgetMonthly = {
      limit: Math.round(limit),
      spent: Math.round(monthTotal),
      remaining: Math.round(limit - monthTotal),
      percent: Math.round((monthTotal / limit) * 100),
    };
  }

  return ctx;
}
