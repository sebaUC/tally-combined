import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * ManageCategoriesToolHandler - CRUD for user categories via chat.
 *
 * Operations:
 * - list: Show all categories with hierarchy
 * - create: Add a new category (optionally as subcategory)
 * - rename: Change category name
 * - delete: Remove category (with orphan transaction protection)
 *
 * Can also handle _pending_transaction to create a category AND register
 * a transaction in one turn (bridging from register_transaction flow).
 */
export class ManageCategoriesToolHandler implements ToolHandler {
  readonly name = 'manage_categories';

  readonly schema: ToolSchema = {
    name: 'manage_categories',
    description:
      'Gestiona las categorías del usuario: listar todas, crear nueva, renombrar o eliminar una categoría existente.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Operación: "list", "create", "rename", "delete"',
        },
        name: {
          type: 'string',
          description:
            'Nombre de la categoría (para create, rename fuente, delete)',
        },
        new_name: {
          type: 'string',
          description: 'Nuevo nombre (solo para rename)',
        },
        icon: {
          type: 'string',
          description: 'Emoji/ícono para la categoría (opcional en create)',
        },
        parent_name: {
          type: 'string',
          description: 'Nombre de categoría padre para crear subcategoría',
        },
        force_delete: {
          type: 'boolean',
          description:
            'Forzar eliminación si la categoría tiene transacciones asociadas',
        },
        _pending_transaction: {
          type: 'object',
          description:
            'Datos de transacción pendiente para registrar después de crear categoría (internal)',
        },
      },
      required: ['operation'],
    },
  };

  readonly requiresContext = true;

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    _msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    // Infer operation when omitted
    let operation = args.operation as string | undefined;
    if (!operation) {
      if (args.new_name) operation = 'rename';
      else if (args.name) operation = 'create';
      else operation = 'list';
    }

    switch (operation) {
      case 'list':
        return this.handleList(userId);
      case 'create':
        return this.handleCreate(userId, args);
      case 'rename':
        return this.handleRename(userId, args);
      case 'delete':
        return this.handleDelete(userId, args);
      default:
        return {
          ok: false,
          action: 'manage_categories',
          userMessage: `Operación "${operation}" no reconocida. Usa list, create, rename o delete.`,
        };
    }
  }

  // ─── LIST ───────────────────────────────────────────────────────

  private async handleList(userId: string): Promise<ActionResult> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, icon, parent_id, budget')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      return {
        ok: false,
        action: 'manage_categories',
        errorCode: 'DB_QUERY_FAILED',
        userMessage: 'Hubo un problema consultando tus categorías.',
      };
    }

    const rows = data ?? [];
    const parents = rows.filter((r: any) => !r.parent_id);
    const children = rows.filter((r: any) => r.parent_id);

    const categories = parents.map((p: any) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      budget: p.budget ?? 0,
      children: children
        .filter((c: any) => c.parent_id === p.id)
        .map((c: any) => ({ id: c.id, name: c.name, icon: c.icon, budget: c.budget ?? 0 })),
    }));

    return {
      ok: true,
      action: 'manage_categories',
      data: { operation: 'list', categories, count: rows.length },
    };
  }

  // ─── CREATE ─────────────────────────────────────────────────────

  private async handleCreate(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const name = args.name as string | undefined;
    const icon = args.icon as string | undefined;
    const parentName = args.parent_name as string | undefined;
    const pendingTx = args._pending_transaction as Record<string, unknown> | undefined;

    if (!name || name.trim().length < 1) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: '¿Cómo quieres que se llame la nueva categoría?',
        pending: {
          collectedArgs: { operation: 'create' },
          missingArgs: ['name'],
        },
      };
    }

    const trimmedName = name.trim();

    // Validate length
    if (trimmedName.length > 50) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: 'El nombre es muy largo. Máximo 50 caracteres.',
      };
    }

    // Check max 50 categories
    const { count } = await this.supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((count ?? 0) >= 50) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: 'Llegaste al límite de 50 categorías. Elimina alguna antes de crear nuevas.',
      };
    }

    // Check duplicate (case-insensitive)
    const { data: existing } = await this.supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', trimmedName);

    if (existing?.length) {
      // Silent dedup: use existing category instead of creating
      const existingCat = existing[0];

      if (pendingTx) {
        return this.registerWithCategory(userId, existingCat, pendingTx);
      }

      return {
        ok: true,
        action: 'manage_categories',
        data: {
          operation: 'create',
          name: existingCat.name,
          already_existed: true,
        },
      };
    }

    // Resolve parent if specified
    let parentId: string | null = null;
    if (parentName) {
      const { data: parentCats } = await this.supabase
        .from('categories')
        .select('id, parent_id')
        .eq('user_id', userId)
        .ilike('name', parentName.trim());

      if (!parentCats?.length) {
        return {
          ok: true,
          action: 'manage_categories',
          userMessage: `No encontré la categoría padre "${parentName}".`,
        };
      }

      const parent = parentCats[0];
      if (parent.parent_id) {
        return {
          ok: true,
          action: 'manage_categories',
          userMessage: 'No se puede crear una subcategoría dentro de otra subcategoría.',
        };
      }
      parentId = parent.id;
    }

    // Insert
    const { data: created, error } = await this.supabase
      .from('categories')
      .insert({
        user_id: userId,
        name: trimmedName,
        icon: icon ?? null,
        parent_id: parentId,
        budget: 0,
        created_at: new Date().toISOString(),
      })
      .select('id, name, icon, parent_id, budget')
      .single();

    if (error) {
      return {
        ok: false,
        action: 'manage_categories',
        errorCode: 'DB_INSERT_FAILED',
        userMessage: 'Hubo un problema creando la categoría.',
      };
    }

    // If there's a pending transaction, register it now
    if (pendingTx) {
      return this.registerWithCategory(userId, created, pendingTx);
    }

    return {
      ok: true,
      action: 'manage_categories',
      data: { operation: 'create', name: created.name, icon: created.icon },
    };
  }

  // ─── RENAME ─────────────────────────────────────────────────────

  private async handleRename(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const name = args.name as string | undefined;
    const newName = args.new_name as string | undefined;

    if (!name) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: '¿Cuál categoría quieres renombrar?',
        pending: {
          collectedArgs: { operation: 'rename', ...(newName ? { new_name: newName } : {}) },
          missingArgs: ['name'],
        },
      };
    }

    if (!newName) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: `¿Cómo quieres que se llame ahora "${name}"?`,
        pending: {
          collectedArgs: { operation: 'rename', name },
          missingArgs: ['new_name'],
        },
      };
    }

    // Find category by name
    const { data: cats } = await this.supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', name.trim());

    if (!cats?.length) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: `No encontré la categoría "${name}".`,
      };
    }

    // Check duplicate new name
    const { data: dup } = await this.supabase
      .from('categories')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', newName.trim())
      .neq('id', cats[0].id);

    if (dup?.length) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: `Ya tienes una categoría llamada "${newName}".`,
      };
    }

    const { error } = await this.supabase
      .from('categories')
      .update({ name: newName.trim() })
      .eq('id', cats[0].id)
      .eq('user_id', userId);

    if (error) {
      return {
        ok: false,
        action: 'manage_categories',
        errorCode: 'DB_UPDATE_FAILED',
        userMessage: 'Hubo un problema renombrando la categoría.',
      };
    }

    return {
      ok: true,
      action: 'manage_categories',
      data: { operation: 'rename', old_name: cats[0].name, new_name: newName.trim() },
    };
  }

  // ─── DELETE ─────────────────────────────────────────────────────

  private async handleDelete(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const name = args.name as string | undefined;
    const forceDelete = args.force_delete as boolean | undefined;

    if (!name) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: '¿Cuál categoría quieres eliminar?',
        pending: {
          collectedArgs: { operation: 'delete' },
          missingArgs: ['name'],
        },
      };
    }

    // Find category
    const { data: cats } = await this.supabase
      .from('categories')
      .select('id, name, parent_id')
      .eq('user_id', userId)
      .ilike('name', name.trim());

    if (!cats?.length) {
      return {
        ok: true,
        action: 'manage_categories',
        userMessage: `No encontré la categoría "${name}".`,
      };
    }

    const cat = cats[0];

    // Count transactions
    const { count: txCount } = await this.supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', cat.id);

    // Count children
    const { count: childCount } = await this.supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', cat.id);

    if ((txCount ?? 0) > 0 && !forceDelete) {
      let warning = `La categoría "${cat.name}" tiene ${txCount} transacciones asociadas.`;
      if ((childCount ?? 0) > 0) {
        warning += ` También tiene ${childCount} subcategorías que se eliminarán.`;
      }
      warning += ' ¿Estás seguro?';

      return {
        ok: true,
        action: 'manage_categories',
        userMessage: warning,
        pending: {
          collectedArgs: { operation: 'delete', name: cat.name, _has_transactions: true },
          missingArgs: ['force_delete'],
        },
      };
    }

    // Nullify transactions
    if ((txCount ?? 0) > 0) {
      await this.supabase
        .from('transactions')
        .update({ category_id: null })
        .eq('category_id', cat.id);
    }

    // Delete children
    if ((childCount ?? 0) > 0) {
      const { data: childCats } = await this.supabase
        .from('categories')
        .select('id')
        .eq('parent_id', cat.id);

      if (childCats?.length) {
        const childIds = childCats.map((c: any) => c.id);
        await this.supabase
          .from('transactions')
          .update({ category_id: null })
          .in('category_id', childIds);
        await this.supabase
          .from('categories')
          .delete()
          .in('id', childIds);
      }
    }

    // Delete category
    const { error } = await this.supabase
      .from('categories')
      .delete()
      .eq('id', cat.id)
      .eq('user_id', userId);

    if (error) {
      return {
        ok: false,
        action: 'manage_categories',
        errorCode: 'DB_DELETE_FAILED',
        userMessage: 'Hubo un problema eliminando la categoría.',
      };
    }

    return {
      ok: true,
      action: 'manage_categories',
      data: {
        operation: 'delete',
        name: cat.name,
        transactionsAffected: txCount ?? 0,
        childrenDeleted: childCount ?? 0,
      },
    };
  }

  // ─── BRIDGE: Create category + register pending transaction ─────

  private async registerWithCategory(
    userId: string,
    category: { id: string; name: string },
    pendingTx: Record<string, unknown>,
  ): Promise<ActionResult> {
    const amount = Number(pendingTx.amount);
    const description = (pendingTx.description as string) ?? null;
    const postedAt = (pendingTx.posted_at as string) ?? new Date().toISOString();

    // Get default account
    const { data: account } = await this.supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!account) {
      return {
        ok: true,
        action: 'manage_categories',
        data: { operation: 'create', category: { id: category.id, name: category.name } },
        // Transaction can't be registered without account
      };
    }

    const { data: inserted, error } = await this.supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount,
        category_id: category.id,
        posted_at: postedAt,
        description,
        account_id: account.id,
        source: 'chat_intent',
        status: 'posted',
      })
      .select('id')
      .single();

    // Update account balance (expense by default)
    if (!error && account.id) {
      await this.supabase.rpc('update_account_balance', {
        p_account_id: account.id,
        p_delta: -amount,
      });
    }

    if (error) {
      return {
        ok: true,
        action: 'manage_categories',
        data: { operation: 'create', name: category.name },
        // Category was created, but transaction failed — still ok
      };
    }

    return {
      ok: true,
      action: 'manage_categories',
      data: {
        operation: 'create_and_register',
        name: category.name,
        registered_transaction: {
          transaction_id: inserted?.id,
          amount,
          category: category.name,
          posted_at: postedAt,
          description,
        },
      },
    };
  }
}
