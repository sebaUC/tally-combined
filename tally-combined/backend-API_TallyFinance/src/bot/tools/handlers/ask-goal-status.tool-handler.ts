import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * AskGoalStatusToolHandler - Queries user's financial goals progress.
 *
 * Requires context: true (needs goals data)
 *
 * Features:
 * - Can query all goals or a specific goal by ID
 * - Calculates progress percentage
 */
export class AskGoalStatusToolHandler implements ToolHandler {
  readonly name = 'ask_goal_status';

  readonly schema: ToolSchema = {
    name: 'ask_goal_status',
    description:
      'Consulta el estado de las metas financieras del usuario (ahorro, objetivos)',
    parameters: {
      type: 'object',
      properties: {
        goalId: {
          type: 'string',
          description: 'ID de una meta específica (opcional)',
        },
      },
      required: [],
    },
  };

  readonly requiresContext = true;

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    _msg: DomainMessage,
    args: Record<string, any>,
  ): Promise<ActionResult> {
    const { goalId } = args;

    let query = this.supabase
      .from('goals')
      .select('id, name, target_amount, progress_amount, target_date, status')
      .eq('user_id', userId);

    if (goalId) {
      query = query.eq('id', goalId);
    }

    const { data: goals, error } = await query;

    if (error) {
      console.error('[AskGoalStatusToolHandler] Query error:', error);
      return {
        ok: false,
        action: 'ask_goal_status',
        errorCode: 'DB_QUERY_FAILED',
      };
    }

    if (!goals?.length) {
      return {
        ok: true,
        action: 'ask_goal_status',
        userMessage:
          'Aún no configuraste metas financieras. ¿Quieres agregar una?',
      };
    }

    // Calculate percentages
    const goalsWithProgress = goals.map((g: any) => ({
      id: g.id,
      name: g.name,
      target_amount: g.target_amount,
      progress_amount: g.progress_amount ?? 0,
      target_date: g.target_date,
      status: g.status,
      percentage:
        g.target_amount > 0
          ? Math.min(
              100,
              Math.round(((g.progress_amount ?? 0) / g.target_amount) * 100),
            )
          : 0,
    }));

    return {
      ok: true,
      action: 'ask_goal_status',
      data: { goals: goalsWithProgress },
    };
  }
}
