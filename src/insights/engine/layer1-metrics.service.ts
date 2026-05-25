import { Injectable, Logger } from '@nestjs/common';
import {
  InsightInput,
  InsightResult,
  TransactionRow,
  CategoryRow,
  BudgetRow,
  CategoryProfileEntry,
  CategoryBaselineEntry,
  WeekdayPatternEntry,
  CurrentMonthState,
  CurrentWeekState,
  BudgetStateEntry,
  HistoricalMonthAnchor,
  LargestExpense,
  DataMaturity,
  SpenderArchetype,
} from '../contracts';
import { computeDistribution } from './distribution';

/**
 * Threshold de monto que define un "ant expense" (gasto hormiga).
 * Configurable a futuro por user, hardcoded por ahora.
 */
const ANT_EXPENSE_THRESHOLD_CLP = 5000;

/**
 * Maturity thresholds. Cualquier feature downstream chequea estos flags.
 */
const MATURITY = {
  SEEDING_MIN_TXS: 1,
  PARTIAL_MIN_TXS: 20,
  MATURE_MIN_TXS: 50,
  MATURE_MIN_DAYS: 30,
  TEMPORAL_PATTERNS_MIN_WEEKS: 6,
  ANOMALY_BASELINES_MIN_TXS_PER_CAT: 30,
  DIARY_MIN_DAYS: 30,
};

/**
 * Layer 1 — el "calculador". Toma transacciones crudas y produce métricas
 * estructuradas. Sin side effects, sin BD: función pura sobre el input.
 *
 * Layer 2 (beats / observations) y Layer 3 (money diary) se construyen
 * encima de este output en servicios separados.
 */
@Injectable()
export class Layer1MetricsService {
  private readonly log = new Logger(Layer1MetricsService.name);

  compute(input: InsightInput): InsightResult {
    const expenses = input.transactions.filter(t => t.type === 'expense');
    const incomes = input.transactions.filter(t => t.type === 'income');
    const totalTx = input.transactions.length;

    const totalSpent = sum(expenses, t => t.amount);
    const totalIncome = sum(incomes, t => t.amount);
    const daysCovered = daysBetween(input.periodStart, input.periodEnd);
    const weeksCovered = Math.max(1, daysCovered / 7);
    const monthsCovered = Math.max(1, daysCovered / 30.42);

    // Distribuciones (escala personal)
    const dailyTotals = bucketByDay(expenses);
    const monthlyTotals = bucketByMonth(expenses);
    const dailySpendDist = computeDistribution(Array.from(dailyTotals.values()));
    const monthlySpendDist = computeDistribution(Array.from(monthlyTotals.values()));
    const txAmountDist = computeDistribution(expenses.map(t => t.amount));

    // Fingerprint por categoría
    const categoryProfile = this.computeCategoryProfile(
      expenses,
      input.categories,
      totalSpent,
      weeksCovered,
      input.periodEnd,
    );
    const categoryBaselines = this.computeCategoryBaselines(expenses);

    // Ritmos
    const weekdayPattern = this.computeWeekdayPattern(expenses, input.categories);
    const dayOfMonthPattern = this.computeDayOfMonthPattern(expenses);
    const { peakDow, peakWom } = this.findPeaks(weekdayPattern, dayOfMonthPattern);

    // Estado actual
    const now = input.periodEnd;
    const currentMonth = this.computeCurrentMonth(expenses, now, monthlySpendDist.mean);
    const currentWeek = this.computeCurrentWeek(expenses, now);
    const budgetState = this.computeBudgetState(expenses, input.budgets, now);

    // Anclas históricas
    const monthlyTrajectory = this.computeMonthlyTrajectory(expenses, input.categories, input.budgets, 6);
    const firstMonth = monthlyTrajectory.length > 0 ? monthlyTrajectory[monthlyTrajectory.length - 1] : null;
    const { best, worst } = this.findBestWorstMonth(monthlyTrajectory);

    // Hechos destacables
    const largestExpense = this.findLargestExpense(expenses, input.categories);
    const antExpenses = expenses.filter(t => t.amount <= ANT_EXPENSE_THRESHOLD_CLP);

    // Identity
    const archetype = this.detectArchetype(expenses, txAmountDist);
    const { primaryCategoryId, concentration } = this.computeConcentration(categoryProfile);

    // Maturity flags
    const maturity = this.computeMaturity(totalTx, daysCovered);
    const flags = this.computeCapabilityFlags(
      totalTx,
      daysCovered,
      weeksCovered,
      categoryProfile,
    );

    return {
      userId: input.userId,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),

      spender_archetype: archetype,
      primary_category_id: primaryCategoryId,
      category_concentration: concentration,
      data_maturity: maturity,

      daily_spend_dist: dailySpendDist,
      tx_amount_dist: txAmountDist,
      monthly_spend_dist: monthlySpendDist,

      category_profile: categoryProfile,
      category_baselines: categoryBaselines,

      weekday_pattern: weekdayPattern,
      day_of_month_pattern: dayOfMonthPattern,
      peak_day_of_week: peakDow,
      peak_week_of_month: peakWom,

      current_month: currentMonth,
      current_week: currentWeek,
      budget_state: budgetState,

      first_month: firstMonth,
      best_month: best,
      worst_month: worst,
      monthly_trajectory: monthlyTrajectory,

      largest_expense: largestExpense,
      ant_expense_count: antExpenses.length,
      ant_expense_total: sum(antExpenses, t => t.amount),

      has_sufficient_data: flags.has_sufficient_data,
      has_temporal_patterns: flags.has_temporal_patterns,
      has_anomaly_baselines: flags.has_anomaly_baselines,
      has_diary: flags.has_diary,

      source: input.source,
      tx_count_at_compute: totalTx,
      computed_at: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  private computeCategoryProfile(
    expenses: TransactionRow[],
    categories: CategoryRow[],
    totalSpent: number,
    weeksCovered: number,
    periodEnd: Date,
  ): Record<string, CategoryProfileEntry> {
    const byCategory = groupBy(expenses, t => t.category_id ?? '__uncategorized__');
    const cutoff30d = new Date(periodEnd.getTime() - 30 * 24 * 3600 * 1000);
    const cutoff60d = new Date(periodEnd.getTime() - 60 * 24 * 3600 * 1000);

    const profile: Record<string, CategoryProfileEntry> = {};
    for (const [catId, txs] of byCategory.entries()) {
      if (catId === '__uncategorized__') continue;

      const cat = categories.find(c => c.id === catId);
      const amounts = txs.map(t => t.amount);
      const catTotal = sum(amounts, x => x);
      const last30 = txs.filter(t => new Date(t.posted_at) >= cutoff30d);
      const last30to60 = txs.filter(t => {
        const d = new Date(t.posted_at);
        return d >= cutoff60d && d < cutoff30d;
      });
      const total30 = sum(last30, t => t.amount);
      const total30to60 = sum(last30to60, t => t.amount);

      let trend: 'up' | 'flat' | 'down' = 'flat';
      if (total30to60 > 0) {
        const ratio = total30 / total30to60;
        if (ratio > 1.15) trend = 'up';
        else if (ratio < 0.85) trend = 'down';
      } else if (total30 > 0) {
        trend = 'up';
      }

      const drift = total30to60 > 0
        ? ((total30 - total30to60) / total30to60) * 100
        : 0;

      profile[catId] = {
        category_id: catId,
        category_name: cat?.name ?? 'Desconocida',
        share_pct: totalSpent > 0 ? (catTotal / totalSpent) * 100 : 0,
        freq_per_week: txs.length / weeksCovered,
        avg_per_tx: amounts.length ? catTotal / amounts.length : 0,
        p90_per_tx: computeDistribution(amounts).p90,
        last_tx_at: txs.length
          ? txs.reduce((acc, t) => (t.posted_at > acc ? t.posted_at : acc), txs[0].posted_at)
          : null,
        trend_30d: trend,
        drift_pct: drift,
      };
    }
    return profile;
  }

  private computeCategoryBaselines(
    expenses: TransactionRow[],
  ): Record<string, CategoryBaselineEntry> {
    const byCategory = groupBy(expenses, t => t.category_id ?? '__uncategorized__');
    const baselines: Record<string, CategoryBaselineEntry> = {};
    for (const [catId, txs] of byCategory.entries()) {
      if (catId === '__uncategorized__') continue;
      const amounts = txs.map(t => t.amount);
      const dist = computeDistribution(amounts);
      baselines[catId] = {
        avg: dist.mean,
        stddev: dist.stddev,
        count: amounts.length,
        max: amounts.length ? Math.max(...amounts) : 0,
      };
    }
    return baselines;
  }

  private computeWeekdayPattern(
    expenses: TransactionRow[],
    categories: CategoryRow[],
  ): Record<number, WeekdayPatternEntry> {
    const pattern: Record<number, WeekdayPatternEntry> = {};
    for (let dow = 0; dow < 7; dow++) {
      const txs = expenses.filter(t => new Date(t.posted_at).getDay() === dow);
      const total = sum(txs, t => t.amount);
      const weeksInRange = Math.max(1, txs.length / 7); // proxy simple
      const byCategory = groupBy(txs, t => t.category_id ?? '__uncategorized__');
      const topCats = Array.from(byCategory.entries())
        .map(([catId, ts]) => ({
          name: categories.find(c => c.id === catId)?.name ?? 'Desconocida',
          total: sum(ts, t => t.amount),
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3)
        .map(c => c.name);

      pattern[dow] = {
        avg_spend: txs.length ? total / weeksInRange : 0,
        tx_count: txs.length,
        top_cats: topCats,
      };
    }
    return pattern;
  }

  private computeDayOfMonthPattern(expenses: TransactionRow[]): Record<number, number> {
    const pattern: Record<number, number> = {};
    for (let dom = 1; dom <= 31; dom++) {
      const txs = expenses.filter(t => new Date(t.posted_at).getDate() === dom);
      pattern[dom] = sum(txs, t => t.amount);
    }
    return pattern;
  }

  private findPeaks(
    weekdayPattern: Record<number, WeekdayPatternEntry>,
    dayOfMonthPattern: Record<number, number>,
  ): { peakDow: number | null; peakWom: number | null } {
    let peakDow: number | null = null;
    let maxDowSpend = 0;
    for (const [dow, entry] of Object.entries(weekdayPattern)) {
      if (entry.avg_spend > maxDowSpend) {
        maxDowSpend = entry.avg_spend;
        peakDow = parseInt(dow, 10);
      }
    }

    // Week of month: 1-4 buckets de 7 días cada uno
    const weekTotals: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const [domStr, amount] of Object.entries(dayOfMonthPattern)) {
      const dom = parseInt(domStr, 10);
      const week = Math.min(4, Math.ceil(dom / 7));
      weekTotals[week] += amount;
    }
    let peakWom: number | null = null;
    let maxWeekSpend = 0;
    for (const [w, total] of Object.entries(weekTotals)) {
      if (total > maxWeekSpend) {
        maxWeekSpend = total;
        peakWom = parseInt(w, 10);
      }
    }

    return { peakDow, peakWom };
  }

  private computeCurrentMonth(
    expenses: TransactionRow[],
    now: Date,
    monthlyMean: number,
  ): CurrentMonthState {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const txsThis = expenses.filter(t => {
      const d = new Date(t.posted_at);
      return d >= monthStart && d <= now;
    });
    const txsLast = expenses.filter(t => {
      const d = new Date(t.posted_at);
      return d >= lastMonthStart && d <= lastMonthEnd;
    });

    const spent = sum(txsThis, t => t.amount);
    const lastMonthSpent = sum(txsLast, t => t.amount);
    const daysIn = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / (24 * 3600 * 1000)) + 1);
    const totalDays = Math.floor((monthEnd.getTime() - monthStart.getTime()) / (24 * 3600 * 1000)) + 1;
    const daysLeft = totalDays - daysIn;

    return {
      spent,
      days_in: daysIn,
      days_left: daysLeft,
      pace_per_day: spent / daysIn,
      projected_total: (spent / daysIn) * totalDays,
      vs_last_month_pct: lastMonthSpent > 0
        ? ((spent - lastMonthSpent) / lastMonthSpent) * 100
        : null,
      vs_avg_pct: monthlyMean > 0
        ? ((spent - monthlyMean) / monthlyMean) * 100
        : null,
    };
  }

  private computeCurrentWeek(expenses: TransactionRow[], now: Date): CurrentWeekState {
    const dow = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - dow);
    weekStart.setHours(0, 0, 0, 0);

    const txs = expenses.filter(t => new Date(t.posted_at) >= weekStart && new Date(t.posted_at) <= now);
    const spent = sum(txs, t => t.amount);
    const daysIn = dow + 1;
    const daysLeft = 7 - daysIn;

    return {
      spent,
      days_in: daysIn,
      days_left: daysLeft,
      pace_per_day: spent / daysIn,
    };
  }

  private computeBudgetState(
    expenses: TransactionRow[],
    budgets: BudgetRow[],
    now: Date,
  ): BudgetStateEntry[] {
    const result: BudgetStateEntry[] = [];
    for (const budget of budgets) {
      if (!budget.active) continue;
      const { start, end } = budgetWindow(budget.period, now);
      const txs = expenses.filter(t => {
        const d = new Date(t.posted_at);
        return d >= start && d <= now;
      });
      const spent = sum(txs, t => t.amount);
      const daysLeft = Math.max(
        0,
        Math.floor((end.getTime() - now.getTime()) / (24 * 3600 * 1000)),
      );
      const daysIn = Math.max(
        1,
        Math.floor((now.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1,
      );
      const pace = spent / daysIn;
      const projectedTotal = pace * (daysIn + daysLeft);
      const projectedOverrun = Math.max(0, projectedTotal - budget.amount);
      const breakEta = pace > 0 && spent < budget.amount
        ? new Date(now.getTime() + ((budget.amount - spent) / pace) * 24 * 3600 * 1000).toISOString()
        : null;

      result.push({
        budget_id: `${budget.period}:${budget.amount}`,
        period: budget.period,
        amount: budget.amount,
        spent,
        spent_pct: budget.amount > 0 ? (spent / budget.amount) * 100 : 0,
        days_left: daysLeft,
        projected_overrun: projectedOverrun,
        break_eta: breakEta,
      });
    }
    return result;
  }

  private computeMonthlyTrajectory(
    expenses: TransactionRow[],
    categories: CategoryRow[],
    budgets: BudgetRow[],
    monthsBack: number,
  ): HistoricalMonthAnchor[] {
    const trajectory: HistoricalMonthAnchor[] = [];
    const monthlyBudget = budgets.find(b => b.period === 'monthly' && b.active)?.amount ?? null;

    const monthlyBuckets = bucketByMonth(expenses);
    const sortedMonths = Array.from(monthlyBuckets.keys()).sort().reverse().slice(0, monthsBack);

    for (const monthKey of sortedMonths) {
      const monthTxs = expenses.filter(t => t.posted_at.startsWith(monthKey));
      const spent = monthlyBuckets.get(monthKey) ?? 0;
      const byCat = groupBy(monthTxs, t => t.category_id ?? '__uncategorized__');
      let topCatName: string | null = null;
      let topCatTotal = 0;
      for (const [catId, txs] of byCat.entries()) {
        if (catId === '__uncategorized__') continue;
        const total = sum(txs, t => t.amount);
        if (total > topCatTotal) {
          topCatTotal = total;
          topCatName = categories.find(c => c.id === catId)?.name ?? null;
        }
      }
      trajectory.push({
        month: monthKey,
        spent,
        top_cat: topCatName,
        vs_budget_pct: monthlyBudget && monthlyBudget > 0
          ? (spent / monthlyBudget) * 100
          : null,
      });
    }
    return trajectory;
  }

  private findBestWorstMonth(
    trajectory: HistoricalMonthAnchor[],
  ): { best: HistoricalMonthAnchor | null; worst: HistoricalMonthAnchor | null } {
    if (trajectory.length === 0) return { best: null, worst: null };

    const withBudget = trajectory.filter(m => m.vs_budget_pct !== null);
    if (withBudget.length > 0) {
      // Best = menor % de budget. Worst = mayor.
      const sorted = [...withBudget].sort((a, b) => (a.vs_budget_pct ?? 0) - (b.vs_budget_pct ?? 0));
      return { best: sorted[0], worst: sorted[sorted.length - 1] };
    }
    // Sin budget: best = menor spent. Worst = mayor spent.
    const sorted = [...trajectory].sort((a, b) => a.spent - b.spent);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }

  private findLargestExpense(
    expenses: TransactionRow[],
    categories: CategoryRow[],
  ): LargestExpense | null {
    if (expenses.length === 0) return null;
    const largest = expenses.reduce((acc, t) => (t.amount > acc.amount ? t : acc), expenses[0]);
    return {
      tx_id: largest.id,
      amount: largest.amount,
      category_id: largest.category_id,
      category_name: largest.category_id
        ? categories.find(c => c.id === largest.category_id)?.name ?? null
        : null,
      name: largest.name ?? null,
      posted_at: largest.posted_at,
    };
  }

  private detectArchetype(
    expenses: TransactionRow[],
    dist: { p25: number; p75: number; mean: number; count: number },
  ): SpenderArchetype {
    if (expenses.length < MATURITY.PARTIAL_MIN_TXS) return 'unknown';
    // Ant: muchas tx pequeñas. Si > 60% de tx están bajo p25, dominantes son chicas.
    const antShare = expenses.filter(t => t.amount <= dist.p25).length / expenses.length;
    const whaleShare = expenses.filter(t => t.amount >= dist.p75 * 2).length / expenses.length;

    if (antShare > 0.5 && whaleShare < 0.05) return 'ant';
    if (whaleShare > 0.15 && antShare < 0.3) return 'whale';
    return 'mixed';
  }

  private computeConcentration(
    categoryProfile: Record<string, CategoryProfileEntry>,
  ): { primaryCategoryId: string | null; concentration: number } {
    const entries = Object.values(categoryProfile);
    if (entries.length === 0) return { primaryCategoryId: null, concentration: 0 };

    // HHI = sum((share/100)^2). Va de 1/n (perfectamente repartido) a 1 (todo en 1).
    const hhi = entries.reduce((acc, e) => acc + (e.share_pct / 100) ** 2, 0);

    const sorted = [...entries].sort((a, b) => b.share_pct - a.share_pct);
    return {
      primaryCategoryId: sorted[0]?.category_id ?? null,
      concentration: hhi,
    };
  }

  private computeMaturity(txCount: number, daysCovered: number): DataMaturity {
    if (txCount < MATURITY.SEEDING_MIN_TXS) return 'empty';
    if (txCount < MATURITY.PARTIAL_MIN_TXS) return 'seeding';
    if (txCount < MATURITY.MATURE_MIN_TXS || daysCovered < MATURITY.MATURE_MIN_DAYS) {
      return 'partial';
    }
    return 'mature';
  }

  private computeCapabilityFlags(
    txCount: number,
    daysCovered: number,
    weeksCovered: number,
    categoryProfile: Record<string, CategoryProfileEntry>,
  ): {
    has_sufficient_data: boolean;
    has_temporal_patterns: boolean;
    has_anomaly_baselines: boolean;
    has_diary: boolean;
  } {
    const hasSufficient = txCount >= MATURITY.PARTIAL_MIN_TXS;
    const hasTemporal = weeksCovered >= MATURITY.TEMPORAL_PATTERNS_MIN_WEEKS;
    const topCatCounts = Object.values(categoryProfile)
      .sort((a, b) => b.share_pct - a.share_pct)
      .slice(0, 3);
    const hasBaselines = topCatCounts.length > 0
      && topCatCounts.every(c => c.freq_per_week * weeksCovered >= MATURITY.ANOMALY_BASELINES_MIN_TXS_PER_CAT);
    const hasDiary = daysCovered >= MATURITY.DIARY_MIN_DAYS;

    return {
      has_sufficient_data: hasSufficient,
      has_temporal_patterns: hasTemporal,
      has_anomaly_baselines: hasBaselines,
      has_diary: hasDiary,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Utilidades puras (no exportadas)
// ─────────────────────────────────────────────────────────────────────────

function sum<T>(arr: T[], pick: (x: T) => number): number {
  return arr.reduce((acc, x) => acc + pick(x), 0);
}

function groupBy<T, K>(arr: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of arr) {
    const k = keyFn(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 3600 * 1000)));
}

function bucketByDay(txs: TransactionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of txs) {
    const key = t.posted_at.slice(0, 10); // YYYY-MM-DD
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return map;
}

function bucketByMonth(txs: TransactionRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of txs) {
    const key = t.posted_at.slice(0, 7); // YYYY-MM
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return map;
}

function budgetWindow(period: 'daily' | 'weekly' | 'monthly', now: Date): { start: Date; end: Date } {
  if (period === 'daily') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (period === 'weekly') {
    const dow = now.getDay();
    const start = new Date(now);
    start.setDate(start.getDate() - dow);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  // monthly
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}
