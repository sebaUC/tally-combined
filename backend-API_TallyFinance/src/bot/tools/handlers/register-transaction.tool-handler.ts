import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * RegisterTransactionToolHandler - Registers expenses/income.
 *
 * Requires context: true (needs categories, payment methods)
 *
 * Slot-filling:
 * - Asks for amount if missing
 * - Asks for category if missing or not matched
 * - Suggests similar categories if no exact match
 */
export class RegisterTransactionToolHandler implements ToolHandler {
  readonly name = 'register_transaction';

  readonly schema: ToolSchema = {
    name: 'register_transaction',
    description: 'Registra un gasto o ingreso del usuario en su cuenta',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Monto de la transacción en CLP (pesos chilenos)',
        },
        category: {
          type: 'string',
          description:
            'Nombre de la categoría (ej: comida, transporte, entretenimiento)',
        },
        posted_at: {
          type: 'string',
          description:
            'Fecha en formato ISO-8601 (YYYY-MM-DD o ISO completo). Si no se especifica, se usa la fecha actual',
        },
        description: {
          type: 'string',
          description: 'Descripción opcional del gasto',
        },
        type: {
          type: 'string',
          description: 'Tipo: expense (default) o income',
        },
        name: {
          type: 'string',
          description: 'Nombre corto de la transacción',
        },
      },
      required: ['amount', 'category'],
    },
  };

  readonly requiresContext = true;

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    _msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const {
      amount,
      category,
      date,
      posted_at,
      description,
      type,
      name,
      _categories,
    } = args as {
      amount?: number;
      category?: string;
      date?: string;
      posted_at?: string;
      description?: string;
      type?: string;
      name?: string;
      _categories?: Array<{ id: string; name: string }>;
    };

    // 1. Validate required args (slot-filling with pending state)
    if (amount === undefined || amount === null) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage: '¿Cuánto fue exactamente?',
        pending: {
          collectedArgs: {
            ...(category ? { category } : {}),
            ...(description ? { description } : {}),
            ...(posted_at ? { posted_at } : {}),
          },
          missingArgs: ['amount'],
        },
      };
    }

    if (!category) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage:
          '¿En qué categoría lo registro? (ej: comida, transporte, salud…)',
        pending: {
          collectedArgs: {
            amount,
            ...(description ? { description } : {}),
            ...(posted_at ? { posted_at } : {}),
          },
          missingArgs: ['category'],
        },
      };
    }

    // 2. Normalize date to ISO format for posted_at
    const postedAt = posted_at ?? date ?? new Date().toISOString();

    // 3. Get categories: prefer injected from context, fallback to DB query
    let categories = _categories ?? null;
    if (!categories) {
      const { data: dbCategories, error: catError } = await this.supabase
        .from('categories')
        .select('id, name')
        .eq('user_id', userId);

      if (catError) {
        console.error(
          '[RegisterTransactionToolHandler] Category query error:',
          catError,
        );
        return {
          ok: false,
          action: 'register_transaction',
          errorCode: 'DB_QUERY_FAILED',
          userMessage:
            'Hubo un problema consultando tus categorías. Intenta de nuevo.',
        };
      }

      categories = dbCategories as Array<{ id: string; name: string }>;
    }

    if (!categories?.length) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage:
          'Aún no tienes categorías configuradas. Primero crea algunas desde la app web.',
      };
    }

    // 4. Match category: trust LLM output first, lightweight fallback
    const matched = this.findBestCategoryMatch(String(category), categories);

    if (!matched) {
      // No match found - show user their category list
      const suggestions = categories.map((c) => `• ${c.name}`).join('\n');

      // If AI sent a specific name (not _no_match), offer to create it
      if (category !== '_no_match') {
        return {
          ok: true,
          action: 'register_transaction',
          userMessage: `No encontré "${category}". ¿La creo como nueva categoría?\nTambién puedes elegir una existente:\n${suggestions}`,
          pending: {
            collectedArgs: {
              amount,
              ...(description ? { description } : {}),
              ...(posted_at ? { posted_at } : {}),
              _create_category_offer: category,
            },
            missingArgs: ['category'],
          },
        };
      }

      return {
        ok: true,
        action: 'register_transaction',
        userMessage: `¿En qué categoría lo registro?\n${suggestions}`,
        pending: {
          collectedArgs: {
            amount,
            ...(description ? { description } : {}),
            ...(posted_at ? { posted_at } : {}),
          },
          missingArgs: ['category'],
        },
      };
    }

    // 4. Get account_id - user's default account
    const { data: defaultAccount, error: accError } = await this.supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (accError) {
      console.error(
        '[RegisterTransactionToolHandler] Account query error:',
        accError,
      );
      return {
        ok: false,
        action: 'register_transaction',
        errorCode: 'DB_QUERY_FAILED',
        userMessage:
          'Hubo un problema consultando tus cuentas. Intenta de nuevo.',
      };
    }

    if (!defaultAccount) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage:
          'No tienes cuentas configuradas. Completa el onboarding.',
      };
    }

    const accountId = defaultAccount.id;

    // 5. Insert transaction
    const parsedAmount = Number(amount);
    const txType = type ?? 'expense';
    const { data: inserted, error } = await this.supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: parsedAmount,
        category_id: matched.id,
        posted_at: postedAt,
        description: description ?? null,
        account_id: accountId,
        source: 'chat_intent',
        status: 'posted',
        type: txType,
        name: name ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[RegisterTransactionToolHandler] Insert error:', error);
      return {
        ok: false,
        action: 'register_transaction',
        errorCode: 'DB_INSERT_FAILED',
      };
    }

    // 6. Update account balance
    const balanceDelta = txType === 'income' ? parsedAmount : -parsedAmount;
    const { error: balanceError } = await this.supabase.rpc(
      'update_account_balance',
      { p_account_id: accountId, p_delta: balanceDelta },
    );

    if (balanceError) {
      console.error(
        '[RegisterTransactionToolHandler] Balance update error:',
        balanceError,
      );
      // Non-critical: transaction was inserted, balance will be inconsistent
      // but can be recalculated later
    }

    return {
      ok: true,
      action: 'register_transaction',
      data: {
        transaction_id: inserted?.id,
        amount: parsedAmount,
        category: matched.name,
        posted_at: postedAt,
        description: description ?? null,
        account_id: accountId,
        type: txType,
        name: name ?? null,
      },
    };
  }

  /**
   * Finds the best matching category using lightweight fallback.
   * The LLM is the primary category resolver (via Phase A prompt).
   * This method handles: exact match, _no_match sentinel, partial/substring, and typo tolerance.
   */
  private findBestCategoryMatch(
    input: string,
    categories: Array<{ id: string; name: string }>,
  ): { id: string; name: string } | null {
    if (!input || !categories?.length) return null;

    const inputLower = input.toLowerCase().trim();

    // LLM returned _no_match → no category fits
    if (inputLower === '_no_match') return null;

    // 1. EXACT MATCH (case-insensitive) — handles LLM returning correct category name
    const exactMatch = categories.find(
      (c) => c.name?.toLowerCase() === inputLower,
    );
    if (exactMatch) return exactMatch;

    // 2. PARTIAL/SUBSTRING MATCH — lightweight fallback if LLM was close
    const partialMatch = categories.find((cat) => {
      const catLower = cat.name?.toLowerCase() ?? '';
      return catLower.includes(inputLower) || inputLower.includes(catLower);
    });
    if (partialMatch) return partialMatch;

    // 3. TYPO TOLERANCE — catch minor spelling differences
    const typoMatch = categories.find((cat) =>
      this.isSimilarString(inputLower, cat.name?.toLowerCase() ?? '', 2),
    );
    if (typoMatch) return typoMatch;

    return null;
  }

  /**
   * Simple similarity check - allows up to N character differences.
   */
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
