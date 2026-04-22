import { SupabaseClient } from '@supabase/supabase-js';
import { getDateRange } from './shared';

export async function getBalance(
  supabase: SupabaseClient,
  userId: string,
  args: {
    period?: string;
    start_date?: string;
    end_date?: string;
    category?: string;
    include_budget?: boolean;
    include_breakdown?: boolean;
  },
): Promise<Record<string, any>> {
  const period = args.period || 'month';
  const includeBudget = args.include_budget !== false;
  const includeBreakdown = args.include_breakdown || false;

  // 1. Get accounts
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, name, institution, currency, current_balance')
    .eq('user_id', userId);

  if (accErr) return { ok: false, error: 'DB_ERROR', message: accErr.message };

  const totalBalance = (accounts || []).reduce(
    (sum: number, a: any) => sum + Number(a.current_balance),
    0,
  );

  // 2. Date range
  const { start, end, label } = getDateRange(
    period,
    args.start_date,
    args.end_date,
  );

  // 3. Resolve category filter
  let categoryId: string | undefined;
  if (args.category) {
    const { data: cat } = await supabase
      .from('categories')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', args.category)
      .maybeSingle();
    categoryId = cat?.id;
  }

  // 4. Query expenses
  let expQuery = supabase
    .from('transactions')
    .select('amount, category_id, categories:category_id(name)')
    .eq('user_id', userId)
    .eq('type', 'expense')
    .gte('posted_at', start)
    .lte('posted_at', end);

  if (categoryId) expQuery = expQuery.eq('category_id', categoryId);

  const { data: expenses } = await expQuery;
  const totalSpent = (expenses || []).reduce(
    (sum: number, tx: any) => sum + Number(tx.amount),
    0,
  );

  // 5. Query income
  const incQuery = supabase
    .from('transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('type', 'income')
    .gte('posted_at', start)
    .lte('posted_at', end);

  const { data: incomes } = await incQuery;
  const totalIncome = (incomes || []).reduce(
    (sum: number, tx: any) => sum + Number(tx.amount),
    0,
  );

  // 6. Budget (optional)
  let activeBudget: any = null;
  if (includeBudget) {
    const { data: budget } = await supabase
      .from('spending_expectations')
      .select('period, amount')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (budget?.amount) {
      const budgetAmount = Number(budget.amount);
      activeBudget = {
        period: budget.period,
        amount: budgetAmount,
        spent: totalSpent,
        remaining: budgetAmount - totalSpent,
        percent: Math.round((totalSpent / budgetAmount) * 100),
      };
    }
  }

  // 7. Breakdown by category (optional)
  let breakdown: any[] | undefined;
  if (includeBreakdown && expenses?.length) {
    const byCategory = new Map<string, number>();
    for (const tx of expenses) {
      const catName = (tx as any).categories?.name || 'Sin categoría';
      byCategory.set(
        catName,
        (byCategory.get(catName) || 0) + Number(tx.amount),
      );
    }
    breakdown = Array.from(byCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  return {
    ok: true,
    data: {
      totalBalance,
      totalSpent,
      totalIncome,
      netFlow: totalIncome - totalSpent,
      period: label,
      accounts: (accounts || []).map((a: any) => ({
        name: a.name,
        balance: Number(a.current_balance),
        currency: a.currency,
      })),
      ...(activeBudget ? { activeBudget } : {}),
      ...(breakdown ? { breakdown } : {}),
      ...(args.category ? { filteredBy: args.category } : {}),
    },
  };
}
