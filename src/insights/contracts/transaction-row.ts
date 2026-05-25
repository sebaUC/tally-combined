/**
 * Shape mínima de una transacción que el InsightEngine consume.
 *
 * Es un subset de la fila real de `transactions` — solo los campos que el
 * engine necesita. Permite testear con fixtures sin pasar por Supabase.
 */
export interface TransactionRow {
  id: string;
  user_id: string;
  amount: number;
  type: 'expense' | 'income';
  category_id: string | null;
  category_name?: string | null;
  posted_at: string; // ISO-8601
  name?: string | null;
  description?: string | null;
  is_internal_transfer: boolean;
  paired_transaction_id?: string | null;
  account_id?: string | null;
}

/**
 * Shape mínima de una categoría (lookup table).
 */
export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  icon?: string | null;
  budget?: number | null;
}

/**
 * Budget activo del user (de spending_expectations).
 */
export interface BudgetRow {
  user_id: string;
  period: 'daily' | 'weekly' | 'monthly';
  amount: number;
  active: boolean;
}
