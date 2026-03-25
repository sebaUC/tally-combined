/**
 * Routes function calls from Gemini to the appropriate handler.
 * Each function is a pure async function: (supabase, userId, args) → result.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { registerExpense } from './functions/register-expense.fn.js';
import { registerIncome } from './functions/register-income.fn.js';
import { manageCategory } from './functions/manage-category.fn.js';

export function createFunctionRouter(supabase: SupabaseClient, userId: string) {
  return async (name: string, args: Record<string, any>): Promise<Record<string, any>> => {
    switch (name) {
      case 'register_expense':
        return registerExpense(supabase, userId, args as any);

      case 'register_income':
        return registerIncome(supabase, userId, args as any);

      case 'query_transactions':
        return { ok: false, error: 'NOT_IMPLEMENTED', message: 'query_transactions coming soon' };

      case 'edit_transaction':
        return { ok: false, error: 'NOT_IMPLEMENTED', message: 'edit_transaction coming soon' };

      case 'delete_transaction':
        return { ok: false, error: 'NOT_IMPLEMENTED', message: 'delete_transaction coming soon' };

      case 'manage_category':
        return manageCategory(supabase, userId, args as any);

      case 'get_balance':
        return { ok: false, error: 'NOT_IMPLEMENTED', message: 'get_balance coming soon' };

      case 'get_app_info':
        return {
          ok: true,
          data: {
            answer: 'TallyFinance es tu asistente financiero personal. Puedes registrar gastos e ingresos, gestionar categorías, consultar tu balance y presupuesto, todo desde el chat con Gus.',
          },
        };

      default:
        return { ok: false, error: 'UNKNOWN_FUNCTION', message: `Unknown function: ${name}` };
    }
  };
}
