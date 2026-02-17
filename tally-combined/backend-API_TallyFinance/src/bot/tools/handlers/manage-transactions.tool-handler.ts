import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * ManageTransactionsToolHandler - List, edit, and delete existing transactions.
 *
 * Requires context: true (needs categories for edit operations)
 *
 * Operations:
 * - list: Show recent transactions
 * - edit: Modify fields (amount, category, description, date) on an existing transaction
 * - delete: Remove an existing transaction
 *
 * Transaction resolution: by transaction_id, by hints (amount, category, description),
 * or defaults to most recent. Disambiguation via slot-fill when multiple matches.
 */
export class ManageTransactionsToolHandler implements ToolHandler {
  readonly name = 'manage_transactions';

  readonly schema: ToolSchema = {
    name: 'manage_transactions',
    description:
      'Gestiona transacciones existentes del usuario: listar las últimas, editar campos (monto, categoría, descripción, fecha), o eliminar una transacción. Usa hints para identificar la transacción objetivo si no tienes el ID.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description:
            'Operación a realizar: "list", "edit", o "delete"',
        },
        transaction_id: {
          type: 'string',
          description:
            'UUID de la transacción (si se conoce del historial de conversación)',
        },
        hint_amount: {
          type: 'number',
          description:
            'Monto aproximado para identificar la transacción',
        },
        hint_category: {
          type: 'string',
          description:
            'Categoría para identificar la transacción',
        },
        hint_description: {
          type: 'string',
          description:
            'Descripción parcial para identificar la transacción',
        },
        limit: {
          type: 'number',
          description:
            'Cantidad de transacciones a listar (default 5, max 20)',
        },
        new_amount: {
          type: 'number',
          description: 'Nuevo monto para editar',
        },
        new_category: {
          type: 'string',
          description: 'Nueva categoría para editar',
        },
        new_description: {
          type: 'string',
          description: 'Nueva descripción para editar',
        },
        new_posted_at: {
          type: 'string',
          description: 'Nueva fecha para editar (ISO-8601)',
        },
        choice: {
          type: 'number',
          description:
            'Número 1-based para elegir entre transacciones ambiguas',
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
    // Infer operation when AI omits it — deduce from which args are present
    let operation = args.operation as string | undefined;
    if (!operation) {
      const hasNewFields =
        args.new_amount !== undefined ||
        args.new_category !== undefined ||
        args.new_description !== undefined ||
        args.new_posted_at !== undefined;
      operation = hasNewFields ? 'edit' : 'list'; // list is safest default (non-destructive)
    }
    args.operation = operation;

    switch (operation) {
      case 'list':
        return this.handleList(userId, args);
      case 'edit':
        return this.handleEdit(userId, args);
      case 'delete':
        return this.handleDelete(userId, args);
      default:
        return {
          ok: false,
          action: 'manage_transactions',
          userMessage: `Operación "${operation}" no reconocida. Usa list, edit o delete.`,
        };
    }
  }

  // ─── LIST ───────────────────────────────────────────────────────

  private async handleList(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

    const { data: transactions, error } = await this.supabase
      .from('transactions')
      .select('id, amount, posted_at, description, categories(name), payment_method(name)')
      .eq('user_id', userId)
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[ManageTransactionsToolHandler] List query error:', error);
      return {
        ok: false,
        action: 'manage_transactions',
        errorCode: 'DB_QUERY_FAILED',
        userMessage: 'Hubo un problema consultando tus transacciones.',
      };
    }

    const formatted = (transactions ?? []).map((tx: any) => ({
      transaction_id: tx.id,
      amount: tx.amount,
      category: tx.categories?.name ?? null,
      description: tx.description ?? null,
      posted_at: tx.posted_at,
      payment_method: tx.payment_method?.name ?? null,
    }));

    return {
      ok: true,
      action: 'manage_transactions',
      data: {
        operation: 'list',
        transactions: formatted,
        count: formatted.length,
      },
    };
  }

  // ─── DELETE ─────────────────────────────────────────────────────

  private async handleDelete(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const resolved = await this.resolveTransaction(userId, args);
    if (resolved.earlyReturn) return resolved.earlyReturn;

    const tx = resolved.transaction!;

    const { error } = await this.supabase
      .from('transactions')
      .delete()
      .eq('id', tx.id)
      .eq('user_id', userId);

    if (error) {
      console.error('[ManageTransactionsToolHandler] Delete error:', error);
      return {
        ok: false,
        action: 'manage_transactions',
        errorCode: 'DB_DELETE_FAILED',
        userMessage: 'Hubo un problema eliminando la transacción.',
      };
    }

    return {
      ok: true,
      action: 'manage_transactions',
      data: {
        operation: 'delete',
        deleted: {
          transaction_id: tx.id,
          amount: tx.amount,
          category: tx.category,
          description: tx.description,
          posted_at: tx.posted_at,
        },
      },
    };
  }

  // ─── EDIT ───────────────────────────────────────────────────────

  private async handleEdit(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const { new_amount, new_category, new_description, new_posted_at, _categories } =
      args as {
        new_amount?: number;
        new_category?: string;
        new_description?: string;
        new_posted_at?: string;
        _categories?: Array<{ id: string; name: string }>;
      };

    // Must have at least one new_* field
    if (
      new_amount === undefined &&
      new_category === undefined &&
      new_description === undefined &&
      new_posted_at === undefined
    ) {
      return {
        ok: true,
        action: 'manage_transactions',
        userMessage: '¿Qué quieres cambiar? Puedes modificar el monto, categoría, descripción o fecha.',
        pending: {
          collectedArgs: {
            operation: 'edit',
            ...(args.transaction_id ? { transaction_id: args.transaction_id } : {}),
            ...(args.hint_amount ? { hint_amount: args.hint_amount } : {}),
            ...(args.hint_category ? { hint_category: args.hint_category } : {}),
            ...(args.hint_description ? { hint_description: args.hint_description } : {}),
          },
          missingArgs: ['new_amount', 'new_category', 'new_description', 'new_posted_at'],
        },
      };
    }

    const resolved = await this.resolveTransaction(userId, args);
    if (resolved.earlyReturn) return resolved.earlyReturn;

    const tx = resolved.transaction!;

    // Build update payload
    const updatePayload: Record<string, any> = {};
    const changes: string[] = [];

    if (new_amount !== undefined) {
      updatePayload.amount = new_amount;
      changes.push('monto');
    }

    if (new_category !== undefined) {
      // Resolve category
      let categories = _categories ?? null;
      if (!categories) {
        const { data: dbCats, error: catErr } = await this.supabase
          .from('categories')
          .select('id, name')
          .eq('user_id', userId);

        if (catErr) {
          return {
            ok: false,
            action: 'manage_transactions',
            errorCode: 'DB_QUERY_FAILED',
            userMessage: 'Hubo un problema consultando tus categorías.',
          };
        }
        categories = dbCats as Array<{ id: string; name: string }>;
      }

      const matched = this.findBestCategoryMatch(String(new_category), categories ?? []);
      if (!matched) {
        const suggestions = (categories ?? []).map((c) => `• ${c.name}`).join('\n');
        return {
          ok: true,
          action: 'manage_transactions',
          userMessage: new_category === '_no_match'
            ? `¿En qué categoría lo cambio?\n${suggestions}`
            : `No encontré la categoría "${new_category}". Elige una:\n${suggestions}`,
          pending: {
            collectedArgs: {
              operation: 'edit',
              transaction_id: tx.id,
              ...(new_amount !== undefined ? { new_amount } : {}),
              ...(new_description !== undefined ? { new_description } : {}),
              ...(new_posted_at !== undefined ? { new_posted_at } : {}),
            },
            missingArgs: ['new_category'],
          },
        };
      }

      updatePayload.category_id = matched.id;
      changes.push('categoría');
    }

    if (new_description !== undefined) {
      updatePayload.description = new_description;
      changes.push('descripción');
    }

    if (new_posted_at !== undefined) {
      updatePayload.posted_at = new_posted_at;
      changes.push('fecha');
    }

    // Save previous state for the response
    const previous = {
      amount: tx.amount,
      category: tx.category,
      description: tx.description,
      posted_at: tx.posted_at,
    };

    // Update the transaction
    const { error: updateError } = await this.supabase
      .from('transactions')
      .update(updatePayload)
      .eq('id', tx.id)
      .eq('user_id', userId);

    if (updateError) {
      console.error('[ManageTransactionsToolHandler] Update error:', updateError);
      return {
        ok: false,
        action: 'manage_transactions',
        errorCode: 'DB_UPDATE_FAILED',
        userMessage: 'Hubo un problema actualizando la transacción.',
      };
    }

    // Re-fetch updated transaction
    const { data: updated } = await this.supabase
      .from('transactions')
      .select('id, amount, posted_at, description, categories(name)')
      .eq('id', tx.id)
      .single();

    return {
      ok: true,
      action: 'manage_transactions',
      data: {
        operation: 'edit',
        transaction_id: tx.id,
        previous,
        updated: {
          amount: updated?.amount ?? tx.amount,
          category: (updated as any)?.categories?.name ?? tx.category,
          description: updated?.description ?? tx.description,
          posted_at: updated?.posted_at ?? tx.posted_at,
        },
        changes,
      },
    };
  }

  // ─── TRANSACTION RESOLUTION ─────────────────────────────────────

  private async resolveTransaction(
    userId: string,
    args: Record<string, unknown>,
  ): Promise<{
    transaction?: { id: string; amount: number; category: string; description: string | null; posted_at: string };
    earlyReturn?: ActionResult;
  }> {
    const {
      transaction_id,
      hint_amount,
      hint_category,
      hint_description,
      choice,
      _candidates,
    } = args as {
      transaction_id?: string;
      hint_amount?: number;
      hint_category?: string;
      hint_description?: string;
      choice?: number;
      _candidates?: Array<any>;
      operation?: string;
    };

    // 1. Disambiguation choice from pending state
    if (choice !== undefined && _candidates?.length) {
      const idx = choice - 1; // 1-based → 0-based
      if (idx < 0 || idx >= _candidates.length) {
        return {
          earlyReturn: {
            ok: true,
            action: 'manage_transactions',
            userMessage: `Elige un número entre 1 y ${_candidates.length}.`,
          },
        };
      }
      return { transaction: _candidates[idx] };
    }

    // 2. Direct lookup by transaction_id
    if (transaction_id) {
      const { data: tx, error } = await this.supabase
        .from('transactions')
        .select('id, amount, posted_at, description, categories(name)')
        .eq('id', transaction_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && tx) {
        return {
          transaction: {
            id: tx.id,
            amount: tx.amount,
            category: (tx as any).categories?.name ?? '',
            description: tx.description,
            posted_at: tx.posted_at,
          },
        };
      }

      // transaction_id not found — fall through to hint-based resolution
      // instead of returning early (AI often hallucinates UUIDs)
    }

    // 3. Query recent transactions and filter by hints
    const { data: recent, error } = await this.supabase
      .from('transactions')
      .select('id, amount, posted_at, description, categories(name)')
      .eq('user_id', userId)
      .order('posted_at', { ascending: false })
      .limit(30);

    if (error) {
      return {
        earlyReturn: {
          ok: false,
          action: 'manage_transactions',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus transacciones.',
        },
      };
    }

    if (!recent?.length) {
      return {
        earlyReturn: {
          ok: true,
          action: 'manage_transactions',
          userMessage: 'No tienes transacciones registradas.',
        },
      };
    }

    // Normalize transactions
    const normalized = recent.map((tx: any) => ({
      id: tx.id,
      amount: tx.amount,
      category: tx.categories?.name ?? '',
      description: tx.description ?? null,
      posted_at: tx.posted_at,
    }));

    // No hints → return most recent
    const hasHints =
      hint_amount !== undefined ||
      hint_category !== undefined ||
      hint_description !== undefined;

    if (!hasHints) {
      return { transaction: normalized[0] };
    }

    // Filter by hints
    let candidates = normalized;

    if (hint_amount !== undefined) {
      const tolerance = Math.max(hint_amount * 0.05, 100);
      candidates = candidates.filter(
        (tx) => Math.abs(tx.amount - hint_amount) <= tolerance,
      );
    }

    if (hint_category) {
      const hintLower = hint_category.toLowerCase();
      candidates = candidates.filter(
        (tx) => tx.category.toLowerCase().includes(hintLower),
      );
    }

    if (hint_description) {
      const hintLower = hint_description.toLowerCase();
      candidates = candidates.filter(
        (tx) =>
          tx.description &&
          tx.description.toLowerCase().includes(hintLower),
      );
    }

    // Evaluate results
    if (candidates.length === 0) {
      return {
        earlyReturn: {
          ok: true,
          action: 'manage_transactions',
          userMessage: 'No encontré una transacción con esas características. ¿Me das más detalles?',
        },
      };
    }

    if (candidates.length === 1) {
      return { transaction: candidates[0] };
    }

    // Multiple matches → disambiguation (cap at 5)
    const capped = candidates.slice(0, 5);
    const operation = args.operation as string;
    const formatCLP = (n: number) => `$${n.toLocaleString('es-CL')}`;
    const lines = capped.map((tx, i) => {
      const date = tx.posted_at?.substring(0, 10) ?? '';
      const desc = tx.description ? ` — ${tx.description}` : '';
      return `${i + 1}. ${formatCLP(tx.amount)} en ${tx.category} (${date})${desc}`;
    });

    return {
      earlyReturn: {
        ok: true,
        action: 'manage_transactions',
        userMessage: `Encontré ${candidates.length} transacciones:\n${lines.join('\n')}\n\n¿Cuál? (responde con el número)`,
        pending: {
          collectedArgs: {
            operation,
            _candidates: capped,
            ...(args.new_amount !== undefined ? { new_amount: args.new_amount } : {}),
            ...(args.new_category !== undefined ? { new_category: args.new_category } : {}),
            ...(args.new_description !== undefined ? { new_description: args.new_description } : {}),
            ...(args.new_posted_at !== undefined ? { new_posted_at: args.new_posted_at } : {}),
          },
          missingArgs: ['choice'],
        },
      },
    };
  }

  // ─── CATEGORY MATCHING (duplicated from register-transaction for OCP) ─

  private findBestCategoryMatch(
    input: string,
    categories: Array<{ id: string; name: string }>,
  ): { id: string; name: string } | null {
    if (!input || !categories?.length) return null;

    const inputLower = input.toLowerCase().trim();

    if (inputLower === '_no_match') return null;

    // 1. EXACT MATCH
    const exactMatch = categories.find(
      (c) => c.name?.toLowerCase() === inputLower,
    );
    if (exactMatch) return exactMatch;

    // 2. PARTIAL/SUBSTRING MATCH
    const partialMatch = categories.find((cat) => {
      const catLower = cat.name?.toLowerCase() ?? '';
      return catLower.includes(inputLower) || inputLower.includes(catLower);
    });
    if (partialMatch) return partialMatch;

    // 3. TYPO TOLERANCE
    const typoMatch = categories.find((cat) =>
      this.isSimilarString(inputLower, cat.name?.toLowerCase() ?? '', 2),
    );
    if (typoMatch) return typoMatch;

    return null;
  }

  private isSimilarString(a: string, b: string, maxDiff: number): boolean {
    if (Math.abs(a.length - b.length) > maxDiff) return false;

    let diff = 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > maxDiff) return false;
    }
    diff += Math.abs(a.length - b.length);
    return diff <= maxDiff;
  }
}
