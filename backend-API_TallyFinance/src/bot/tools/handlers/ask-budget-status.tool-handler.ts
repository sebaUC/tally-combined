import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * AskBudgetStatusToolHandler - Queries user's budget configuration.
 *
 * Requires context: true (needs spending expectations)
 */
export class AskBudgetStatusToolHandler implements ToolHandler {
  readonly name = 'ask_budget_status';

  readonly schema: ToolSchema = {
    name: 'ask_budget_status',
    description:
      'Consulta el estado del presupuesto del usuario (límites de gasto configurados)',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  readonly requiresContext = true;

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    _msg: DomainMessage,
    _args: Record<string, any>,
  ): Promise<ActionResult> {
    const { data: spending, error } = await this.supabase
      .from('spending_expectations')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (error) {
      console.error('[AskBudgetStatusToolHandler] Query error:', error);
      return {
        ok: false,
        action: 'ask_budget_status',
        errorCode: 'DB_QUERY_FAILED',
      };
    }

    if (!spending) {
      return {
        ok: true,
        action: 'ask_budget_status',
        userMessage:
          'Aún no configuraste un presupuesto. ¿Quieres que te ayude a crear uno?',
      };
    }

    return {
      ok: true,
      action: 'ask_budget_status',
      data: {
        active: {
          period: spending.period,
          amount: spending.amount,
        },
      },
    };
  }
}
