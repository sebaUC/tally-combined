/**
 * Routes function calls from Gemini to the appropriate handler.
 * Each function is a pure async function: (supabase, userId, args) → result.
 *
 * `deps` carries cross-cutting services that a few handlers need (merchant
 * resolver, preferences). Handlers that don't need them ignore the arg.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { registerExpense } from './functions/register-expense.fn.js';
import { registerIncome } from './functions/register-income.fn.js';
import { manageCategory } from './functions/manage-category.fn.js';
import { queryTransactions } from './functions/query-transactions.fn.js';
import { editTransaction } from './functions/edit-transaction.fn.js';
import { deleteTransaction } from './functions/delete-transaction.fn.js';
import { getBalance } from './functions/get-balance.fn.js';
import { setBalance } from './functions/set-balance.fn.js';
import { getAppInfo } from './functions/get-app-info.fn.js';
import type { FunctionRouterDeps } from './function-deps.js';

export type { FunctionRouterDeps } from './function-deps.js';

export function createFunctionRouter(
  supabase: SupabaseClient,
  userId: string,
  deps: FunctionRouterDeps = {},
) {
  return async (
    name: string,
    args: Record<string, any>,
  ): Promise<Record<string, any>> => {
    switch (name) {
      case 'register_expense':
        return registerExpense(supabase, userId, args as any, deps);

      case 'register_income':
        return registerIncome(supabase, userId, args as any, deps);

      case 'query_transactions':
        return queryTransactions(supabase, userId, args as any);

      case 'edit_transaction':
        return editTransaction(supabase, userId, args as any, deps);

      case 'delete_transaction':
        return deleteTransaction(supabase, userId, args as any);

      case 'manage_category':
        return manageCategory(supabase, userId, args as any);

      case 'get_balance':
        return getBalance(supabase, userId, args as any);

      case 'set_balance':
        return setBalance(supabase, userId, args as any);

      case 'get_app_info':
        return getAppInfo(supabase, userId, args as any);

      default:
        return {
          ok: false,
          error: 'UNKNOWN_FUNCTION',
          message: `Unknown function: ${name}`,
        };
    }
  };
}
