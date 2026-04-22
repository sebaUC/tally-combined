import { SupabaseClient } from '@supabase/supabase-js';
import { pickCategoryEmoji } from './emoji-mapper.js';

export async function manageCategory(
  supabase: SupabaseClient,
  userId: string,
  args: {
    operation: string;
    name?: string;
    new_name?: string;
    icon?: string;
    budget?: number;
    force_delete?: boolean;
  },
): Promise<Record<string, any>> {
  const { operation, name, new_name, icon, budget, force_delete } = args;

  switch (operation) {
    case 'list': {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, icon, budget, parent_id')
        .eq('user_id', userId)
        .order('name');

      if (error)
        return { ok: false, error: 'DB_ERROR', message: error.message };
      return { ok: true, data: { categories: data || [] } };
    }

    case 'create': {
      if (!name) return { ok: false, error: 'NAME_REQUIRED' };

      // Check duplicate (case-insensitive)
      const { data: existing } = await supabase
        .from('categories')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', name);

      if (existing?.length) {
        return {
          ok: true,
          data: { already_existed: true, category: existing[0] },
        };
      }

      // Check max categories (50)
      const { count } = await supabase
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if ((count ?? 0) >= 50) {
        return {
          ok: false,
          error: 'MAX_CATEGORIES',
          message: 'Máximo 50 categorías',
        };
      }

      const { data: created, error } = await supabase
        .from('categories')
        .insert({
          user_id: userId,
          name: name.trim(),
          icon: icon || pickCategoryEmoji(name),
          budget: budget ?? 0,
        })
        .select('id, name, icon')
        .single();

      if (error)
        return { ok: false, error: 'DB_ERROR', message: error.message };
      return { ok: true, data: { operation: 'create', category: created } };
    }

    case 'rename': {
      if (!name || !new_name)
        return { ok: false, error: 'NAME_AND_NEW_NAME_REQUIRED' };

      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', name)
        .maybeSingle();

      if (!cat)
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `Categoría "${name}" no existe`,
        };

      const { error } = await supabase
        .from('categories')
        .update({ name: new_name.trim() })
        .eq('id', cat.id);

      if (error)
        return { ok: false, error: 'DB_ERROR', message: error.message };
      return {
        ok: true,
        data: {
          operation: 'rename',
          old_name: name,
          new_name: new_name.trim(),
        },
      };
    }

    case 'delete': {
      if (!name) return { ok: false, error: 'NAME_REQUIRED' };

      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', name)
        .maybeSingle();

      if (!cat)
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `Categoría "${name}" no existe`,
        };

      // Check if has transactions
      const { count } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', cat.id);

      if ((count ?? 0) > 0 && !force_delete) {
        return {
          ok: false,
          error: 'HAS_TRANSACTIONS',
          count,
          message: `"${name}" tiene ${count} transacciones. Usa force_delete para eliminar.`,
        };
      }

      // Unlink transactions
      if ((count ?? 0) > 0) {
        await supabase
          .from('transactions')
          .update({ category_id: null })
          .eq('category_id', cat.id);
      }

      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', cat.id);

      if (error)
        return { ok: false, error: 'DB_ERROR', message: error.message };
      return {
        ok: true,
        data: { operation: 'delete', name, transactionsUnlinked: count ?? 0 },
      };
    }

    case 'update_icon': {
      if (!name || !icon) return { ok: false, error: 'NAME_AND_ICON_REQUIRED' };

      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', name)
        .maybeSingle();

      if (!cat) return { ok: false, error: 'NOT_FOUND' };

      await supabase.from('categories').update({ icon }).eq('id', cat.id);
      return { ok: true, data: { operation: 'update_icon', name, icon } };
    }

    case 'update_budget': {
      if (!name || budget === undefined)
        return { ok: false, error: 'NAME_AND_BUDGET_REQUIRED' };

      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', name)
        .maybeSingle();

      if (!cat) return { ok: false, error: 'NOT_FOUND' };

      await supabase.from('categories').update({ budget }).eq('id', cat.id);
      return { ok: true, data: { operation: 'update_budget', name, budget } };
    }

    default:
      return {
        ok: false,
        error: 'UNKNOWN_OPERATION',
        message: `Operación "${operation}" no válida`,
      };
  }
}
