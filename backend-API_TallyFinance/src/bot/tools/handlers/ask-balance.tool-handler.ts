import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

interface PaymentMethodWithSpending {
  id: string;
  name: string | null;
  institution: string | null;
  payment_type: string;
  currency: string;
  totalSpent: number;
}

interface BalanceData {
  unifiedBalance: boolean;
  totalSpent: number;
  accounts: PaymentMethodWithSpending[];
  activeBudget: {
    period: string;
    amount: number;
    remaining: number;
  } | null;
  periodLabel: string;
}

/**
 * AskBalanceToolHandler - Queries user's spending and budget.
 *
 * Requires context: true (needs payment methods, transactions, budget)
 *
 * Features:
 * - unifiedBalance=true: Shows total spent in single account view
 * - unifiedBalance=false: Shows spending per payment method
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

      // 2. Get user's payment methods
      const { data: paymentMethods, error: pmError } = await this.supabase
        .from('payment_method')
        .select('id, name, institution, payment_type, currency')
        .eq('user_id', userId);

      if (pmError) {
        console.error(
          '[AskBalanceToolHandler] Payment methods query error:',
          pmError,
        );
        return {
          ok: false,
          action: 'ask_balance',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus cuentas.',
        };
      }

      if (!paymentMethods?.length) {
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

      // 4. Get transactions for current period
      const { data: transactions, error: txError } = await this.supabase
        .from('transactions')
        .select('amount, payment_method_id')
        .eq('user_id', userId)
        .gte('posted_at', startOfMonth.toISOString())
        .lte('posted_at', endOfMonth.toISOString());

      if (txError) {
        console.error(
          '[AskBalanceToolHandler] Transactions query error:',
          txError,
        );
        return {
          ok: false,
          action: 'ask_balance',
          errorCode: 'DB_QUERY_FAILED',
          userMessage: 'Hubo un problema consultando tus transacciones.',
        };
      }

      // 5. Calculate spending per payment method
      const spendingByMethod = new Map<string, number>();
      let totalSpent = 0;

      for (const tx of transactions ?? []) {
        const amount = Number(tx.amount) || 0;
        totalSpent += amount;

        const currentSpent = spendingByMethod.get(tx.payment_method_id) || 0;
        spendingByMethod.set(tx.payment_method_id, currentSpent + amount);
      }

      // 6. Build accounts with spending data
      const accountsWithSpending: PaymentMethodWithSpending[] =
        paymentMethods.map(
          (pm: {
            id: string;
            name: string | null;
            institution: string | null;
            payment_type: string;
            currency: string;
          }) => ({
            id: pm.id,
            name: pm.name,
            institution: pm.institution,
            payment_type: pm.payment_type,
            currency: pm.currency,
            totalSpent: spendingByMethod.get(pm.id) || 0,
          }),
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
        // Not critical, continue without budget
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
        totalSpent,
        accounts: accountsWithSpending,
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
