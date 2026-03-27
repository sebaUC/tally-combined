import { SupabaseClient } from '@supabase/supabase-js';
import { pickCategoryEmoji } from './emoji-mapper.js';

/**
 * register_expense — Inserts an expense transaction.
 * Pure function: receives args, executes DB ops, returns result.
 * Returns reactive context for Gemini to comment on.
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
  const name = args.name || generateExpenseName(category, description, amount);

  // Default date+time in Chile timezone with offset (so Supabase stores correctly)
  const postedAt = args.posted_at || getChileTimestamp();

  // 1. Match category (include budget for reactive context)
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, icon, budget')
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

  // 5. Compute reactive context (parallel queries)
  const context = await computePostExpenseContext(
    supabase, userId, matched!.id, matched!.name,
    (matched as any)?.budget ?? 0, amount, account.id,
  );

  // 6. Detect ant expense (gasto hormiga)
  const antExpense = isAntExpense(amount, category, name);
  if (antExpense) {
    context.antExpense = true;
  }

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
      ...(antExpense ? { antExpense: true } : {}),
    },
    context,
  };
}

// ── Name generation + ant expense detection ──

/** Gastos hormiga: montos pequeños y recurrentes en categorías típicas */
const ANT_EXPENSE_THRESHOLD = 5000 // CLP — gastos <= this are candidates
const ANT_CATEGORIES = /café|coffee|snack|golosin|dulce|chicle|bebida|jugo|agua|galleta|completo|sopaipilla|mote|empanada|helad|vending/i

function isAntExpense(amount: number, category: string, name?: string): boolean {
  if (amount > ANT_EXPENSE_THRESHOLD) return false
  const text = `${category} ${name || ''}`.toLowerCase()
  return ANT_CATEGORIES.test(text)
}

function generateExpenseName(category: string, description?: string, amount?: number): string {
  // If description has useful info, use it (title case, max 4 words)
  if (description) {
    const words = description.trim().split(/\s+/).slice(0, 4)
    if (words.length > 0 && words[0].length > 1) {
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }
  }

  // Title-case the category as name
  return category
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

// ── Reactive context: financial signals for Gemini ──

async function computePostExpenseContext(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  categoryName: string,
  categoryBudget: number,
  expenseAmount: number,
  accountId: string,
): Promise<Record<string, any>> {
  const now = new Date();
  const todayStr = now.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const [y, m] = todayStr.split('-');
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const monthStart = `${y}-${m}-01T00:00:00`;
  const monthEnd = `${y}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59`;

  const [
    { data: monthExpenses },
    { data: catMonthExpenses },
    { data: todayExpenses },
    { data: budgets },
    { data: accountData },
  ] = await Promise.all([
    // Total expenses this month
    supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'expense')
      .gte('posted_at', monthStart)
      .lte('posted_at', monthEnd),
    // This category expenses this month
    supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'expense')
      .eq('category_id', categoryId)
      .gte('posted_at', monthStart)
      .lte('posted_at', monthEnd),
    // Today's expenses
    supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', userId)
      .eq('type', 'expense')
      .gte('posted_at', `${todayStr}T00:00:00`)
      .lte('posted_at', `${todayStr}T23:59:59`),
    // Active spending expectations
    supabase
      .from('spending_expectations')
      .select('period, amount')
      .eq('user_id', userId)
      .eq('active', true),
    // Account balance
    supabase
      .from('accounts')
      .select('current_balance')
      .eq('id', accountId)
      .single(),
  ]);

  const monthTotal = (monthExpenses || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const catMonthTotal = (catMonthExpenses || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const catMonthCount = (catMonthExpenses || []).length;
  const todayTotal = (todayExpenses || []).reduce((s: number, t: any) => s + Number(t.amount), 0);

  const ctx: Record<string, any> = {
    todayTotal: Math.round(todayTotal),
    accountBalance: Math.round(Number(accountData?.current_balance ?? 0)),
  };

  // Monthly budget context
  const monthlyBudget = (budgets || []).find((b: any) => b.period === 'monthly');
  if (monthlyBudget && monthlyBudget.amount > 0) {
    const limit = Number(monthlyBudget.amount);
    ctx.budgetMonthly = {
      limit: Math.round(limit),
      spent: Math.round(monthTotal),
      remaining: Math.round(limit - monthTotal),
      percent: Math.round((monthTotal / limit) * 100),
    };
  }

  // Daily budget context
  const dailyBudget = (budgets || []).find((b: any) => b.period === 'daily');
  if (dailyBudget && dailyBudget.amount > 0) {
    const limit = Number(dailyBudget.amount);
    ctx.budgetDaily = {
      limit: Math.round(limit),
      spent: Math.round(todayTotal),
      remaining: Math.round(limit - todayTotal),
      percent: Math.round((todayTotal / limit) * 100),
    };
  }

  // Category budget context
  if (categoryBudget > 0) {
    ctx.categoryBudget = {
      category: categoryName,
      limit: Math.round(categoryBudget),
      spent: Math.round(catMonthTotal),
      remaining: Math.round(categoryBudget - catMonthTotal),
      percent: Math.round((catMonthTotal / categoryBudget) * 100),
    };
  }

  // Category frequency (always useful)
  ctx.categoryThisMonth = {
    name: categoryName,
    count: catMonthCount,
    total: Math.round(catMonthTotal),
  };

  return ctx;
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
