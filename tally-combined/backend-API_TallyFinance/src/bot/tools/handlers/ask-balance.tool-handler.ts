import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

interface AccountWithBalance {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  currentBalance: number;
}

interface BalanceData {
  unifiedBalance: boolean;
  totalBalance: number;
  totalSpent: number;
  totalIncome: number;
  accounts: AccountWithBalance[];
  activeBudget: {
    period: string;
    amount: number;
    remaining: number;
  } | null;
  periodLabel: string;
}

/**
 * AskBalanceToolHandler - Queries user's balance from accounts + period spending.
 *
 * Requires context: true (needs accounts, transactions, budget)
 *
 * Features:
 * - Reads balance from accounts.current_balance (persistido)
 * - Shows period spending (expenses) and income separately
 * - With active budget: Shows remaining budget
 */
export class AskBalanceToolHandler implements ToolHandler {
  readonly name = 'ask_balance';

  readonly schema: ToolSchema = {
    name: 'ask_balance',
    description: 'Consulta el saldo actual de las cuentas del usuario',
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
    _args: Record<string, unknown>,
  ): Promise<ActionResult> {
    try {
      // 1. Get user preferences (unifiedBalance)
      const { data: userPrefs, error: prefsError } = await this.supabase
        .from('user_prefs')
        .select('unified_balance')
        .eq('id', userId)
        .maybeSingle();

      if (prefsError) {
        console.error('[AskBalanceToolHandler] Prefs query error:', prefsError);
        return {
          ok: false,
          action: 'ask_balance',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus preferencias.',
        };
      }

      const unifiedBalance = userPrefs?.unified_balance ?? true;

      // 2. Get user's accounts with balance
      const { data: accounts, error: accError } = await this.supabase
        .from('accounts')
        .select('id, name, institution, currency, current_balance')
        .eq('user_id', userId);

      if (accError) {
        console.error(
          '[AskBalanceToolHandler] Accounts query error:',
          accError,
        );
        return {
          ok: false,
          action: 'ask_balance',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus cuentas.',
        };
      }

      if (!accounts?.length) {
        return {
          ok: true,
          action: 'ask_balance',
          userMessage:
            'Aún no tienes cuentas configuradas. Completa el onboarding desde la app web.',
        };
      }

      // 3. Calculate current period (current month)
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
      );

      const periodLabel = now.toLocaleDateString('es-CL', {
        month: 'long',
        year: 'numeric',
      });

      // 4. Get period expenses
      const { data: periodExpenses, error: expError } = await this.supabase
        .from('transactions')
        .select('amount, account_id')
        .eq('user_id', userId)
        .eq('type', 'expense')
        .gte('posted_at', startOfMonth.toISOString())
        .lte('posted_at', endOfMonth.toISOString());

      if (expError) {
        console.error(
          '[AskBalanceToolHandler] Expenses query error:',
          expError,
        );
      }

      // 5. Get period income
      const { data: periodIncome, error: incError } = await this.supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('type', 'income')
        .gte('posted_at', startOfMonth.toISOString())
        .lte('posted_at', endOfMonth.toISOString());

      if (incError) {
        console.error(
          '[AskBalanceToolHandler] Income query error:',
          incError,
        );
      }

      // 6. Calculate totals
      const totalBalance = accounts.reduce(
        (sum: number, a: any) => sum + Number(a.current_balance),
        0,
      );
      const totalSpent = (periodExpenses ?? []).reduce(
        (sum: number, tx: any) => sum + Number(tx.amount),
        0,
      );
      const totalIncome = (periodIncome ?? []).reduce(
        (sum: number, tx: any) => sum + Number(tx.amount),
        0,
      );

      // 7. Get active budget (monthly preferred)
      const { data: budget, error: budgetError } = await this.supabase
        .from('spending_expectations')
        .select('period, amount')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();

      if (budgetError) {
        console.error(
          '[AskBalanceToolHandler] Budget query error:',
          budgetError,
        );
      }

      let activeBudget: BalanceData['activeBudget'] = null;
      if (budget?.amount) {
        const budgetAmount = Number(budget.amount) || 0;
        activeBudget = {
          period: budget.period,
          amount: budgetAmount,
          remaining: budgetAmount - totalSpent,
        };
      }

      // 8. Return data for Phase B
      const balanceData: BalanceData = {
        unifiedBalance,
        totalBalance,
        totalSpent,
        totalIncome,
        accounts: accounts.map((a: any) => ({
          id: a.id,
          name: a.name,
          institution: a.institution,
          currency: a.currency,
          currentBalance: Number(a.current_balance),
        })),
        activeBudget,
        periodLabel,
      };

      return {
        ok: true,
        action: 'ask_balance',
        data: balanceData,
      };
    } catch (err) {
      console.error('[AskBalanceToolHandler] Unexpected error:', err);
      return {
        ok: false,
        action: 'ask_balance',
        errorCode: 'UNEXPECTED_ERROR',
        userMessage: 'Hubo un error inesperado consultando tu balance.',
      };
    }
  }
}
