import { InsightSource } from './insight-input';

/**
 * Distribución estadística. Percentiles, no solo promedio.
 * El bot usa esto para juzgar magnitud relativa al user.
 */
export interface Distribution {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  mean: number;
  stddev: number;
  count: number;
}

/**
 * Perfil por categoría — qué tan presente es y cómo está evolucionando.
 */
export interface CategoryProfileEntry {
  category_id: string;
  category_name: string;
  share_pct: number;          // % del gasto total
  freq_per_week: number;      // tx promedio por semana
  avg_per_tx: number;
  p90_per_tx: number;
  last_tx_at: string | null;  // ISO
  trend_30d: 'up' | 'flat' | 'down';
  drift_pct: number;          // % de cambio vs 30-60d atrás
}

/**
 * Baseline para anomaly detection. Promedios estables por categoría.
 */
export interface CategoryBaselineEntry {
  avg: number;
  stddev: number;
  count: number;
  max: number;
}

export interface WeekdayPatternEntry {
  avg_spend: number;
  tx_count: number;
  top_cats: string[];  // top 3 category names ordenadas
}

export interface CurrentMonthState {
  spent: number;
  days_in: number;          // días transcurridos del mes
  days_left: number;
  pace_per_day: number;     // spent / days_in
  projected_total: number;  // pace * total_days
  vs_last_month_pct: number | null;
  vs_avg_pct: number | null;
}

export interface CurrentWeekState {
  spent: number;
  days_in: number;
  days_left: number;
  pace_per_day: number;
}

export interface BudgetStateEntry {
  budget_id: string;
  period: 'daily' | 'weekly' | 'monthly';
  amount: number;
  spent: number;
  spent_pct: number;
  days_left: number;
  projected_overrun: number;  // monto proyectado de exceso, 0 si va bien
  break_eta: string | null;   // ISO date estimada de cruce, null si no se proyecta cruzar
}

export interface HistoricalMonthAnchor {
  month: string;       // YYYY-MM
  spent: number;
  top_cat: string | null;
  vs_budget_pct: number | null;
}

export interface LargestExpense {
  tx_id: string;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  name: string | null;
  posted_at: string;
}

/**
 * Maturity del dataset del user.
 * Las features downstream chequean este flag antes de consumir.
 */
export type DataMaturity = 'empty' | 'seeding' | 'partial' | 'mature';

/**
 * Archetype del user como spender.
 * 'ant'   → muchas tx chicas, pocas grandes
 * 'whale' → pocas tx grandes, pocas chicas
 * 'mixed' → ambos
 */
export type SpenderArchetype = 'ant' | 'whale' | 'mixed' | 'unknown';

/**
 * Output canónico de Layer 1 (métricas).
 * Layer 2 (observations) y Layer 3 (diary) se agregan después.
 */
export interface InsightResult {
  userId: string;
  periodStart: string;
  periodEnd: string;

  // Identidad
  spender_archetype: SpenderArchetype;
  primary_category_id: string | null;
  category_concentration: number;  // HHI 0-1
  data_maturity: DataMaturity;

  // Escala personal
  daily_spend_dist: Distribution;
  tx_amount_dist: Distribution;
  monthly_spend_dist: Distribution;

  // Fingerprint
  category_profile: Record<string, CategoryProfileEntry>;
  category_baselines: Record<string, CategoryBaselineEntry>;

  // Ritmos
  weekday_pattern: Record<number, WeekdayPatternEntry>;
  day_of_month_pattern: Record<number, number>;  // dom 1-31 → avg spend
  peak_day_of_week: number | null;
  peak_week_of_month: number | null;

  // Estado actual
  current_month: CurrentMonthState;
  current_week: CurrentWeekState;
  budget_state: BudgetStateEntry[];

  // Anclas históricas
  first_month: HistoricalMonthAnchor | null;
  best_month: HistoricalMonthAnchor | null;
  worst_month: HistoricalMonthAnchor | null;
  monthly_trajectory: HistoricalMonthAnchor[];  // últimos 6m

  // Hechos destacables
  largest_expense: LargestExpense | null;
  ant_expense_count: number;
  ant_expense_total: number;

  // Flags
  has_sufficient_data: boolean;
  has_temporal_patterns: boolean;
  has_anomaly_baselines: boolean;
  has_diary: boolean;

  // Meta
  source: InsightSource;
  tx_count_at_compute: number;
  computed_at: string;
}
