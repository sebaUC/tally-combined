import { TransactionRow, CategoryRow, BudgetRow } from './transaction-row';

/**
 * Fuente desde la que se dispara un compute. Decide cómo se marca el snapshot.
 */
export type InsightSource =
  | 'incremental'        // Trigger #2 — actualización por mutación de tx
  | 'batch_weekly'       // Trigger #3 — cron domingo 03:00 CLT
  | 'manual_recompute'   // Trigger #4 — endpoint on-demand o admin
  | 'onboarding_proxy';  // Seed inicial desde budgets declarados

/**
 * Input al insight engine para un compute completo (no incremental).
 * Las transacciones llegan PRE-FILTRADAS: solo expense+income, sin
 * is_internal_transfer=true. El engine no vuelve a filtrar.
 */
export interface InsightInput {
  userId: string;
  transactions: TransactionRow[];
  categories: CategoryRow[];
  budgets: BudgetRow[];
  periodStart: Date;
  periodEnd: Date;
  source: InsightSource;
}
