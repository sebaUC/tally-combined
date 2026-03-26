import { SupabaseClient } from '@supabase/supabase-js';

export async function queryTransactions(
  supabase: SupabaseClient,
  userId: string,
  args: {
    operation: string;
    type?: string;
    category?: string;
    period?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    search?: string;
  },
): Promise<Record<string, any>> {
  const { operation, search } = args;
  const txType = args.type || 'all';
  const period = args.period || 'month';
  const limit = Math.min(Math.max(args.limit || 10, 1), 50);

  // Calculate date range
  const { start, end } = getDateRange(period, args.start_date, args.end_date);

  // Resolve category to ID
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

  // Build base query
  let query = supabase
    .from('transactions')
    .select(
      operation === 'list'
        ? 'id, amount, type, name, description, posted_at, categories:category_id(name)'
        : 'amount',
    )
    .eq('user_id', userId)
    .gte('posted_at', start)
    .lte('posted_at', end);

  if (txType !== 'all') query = query.eq('type', txType);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  }

  if (operation === 'list') {
    query = query.order('posted_at', { ascending: false }).limit(limit);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: 'DB_ERROR', message: error.message };

  const rows = data || [];

  switch (operation) {
    case 'list':
      return {
        ok: true,
        data: {
          transactions: rows.map((r: any) => ({
            id: r.id,
            amount: Number(r.amount),
            type: r.type,
            name: r.name,
            description: r.description,
            category: r.categories?.name || null,
            posted_at: r.posted_at,
          })),
          count: rows.length,
        },
      };

    case 'sum':
      return {
        ok: true,
        data: {
          total: rows.reduce((s: number, r: any) => s + Number(r.amount), 0),
          count: rows.length,
          period,
          type: txType,
          category: args.category || null,
        },
      };

    case 'count':
      return {
        ok: true,
        data: {
          count: rows.length,
          period,
          type: txType,
          category: args.category || null,
        },
      };

    default:
      return { ok: false, error: 'UNKNOWN_OPERATION' };
  }
}

function getDateRange(period: string, startDate?: string, endDate?: string) {
  const now = new Date();

  switch (period) {
    case 'today': {
      const d = now.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
      return { start: `${d}T00:00:00`, end: `${d}T23:59:59` };
    }
    case 'week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - mondayOffset);
      return {
        start: monday.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) + 'T00:00:00',
        end: now.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) + 'T23:59:59',
      };
    }
    case 'year': {
      const d = now.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
      const y = d.split('-')[0];
      return {
        start: `${y}-01-01T00:00:00`,
        end: `${y}-12-31T23:59:59`,
      };
    }
    case 'custom': {
      return {
        start: startDate ? `${startDate}T00:00:00` : `${now.getFullYear()}-01-01T00:00:00`,
        end: endDate ? `${endDate}T23:59:59` : now.toISOString(),
      };
    }
    default: { // month
      const d = now.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
      const [y, m] = d.split('-');
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      return {
        start: `${y}-${m}-01T00:00:00`,
        end: `${y}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59`,
      };
    }
  }
}
