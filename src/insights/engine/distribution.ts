import { Distribution } from '../contracts';

/**
 * Calcula distribución estadística (percentiles + mean + stddev) sobre
 * un array de números. Devuelve ceros si está vacío.
 *
 * Percentiles con interpolación lineal (método estándar de pandas).
 */
export function computeDistribution(values: number[]): Distribution {
  if (values.length === 0) {
    return { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, mean: 0, stddev: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const percentile = (p: number): number => {
    if (n === 1) return sorted[0];
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const frac = idx - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  };

  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance =
    n > 1
      ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
      : 0;
  const stddev = Math.sqrt(variance);

  return {
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
    p90: percentile(90),
    p95: percentile(95),
    mean,
    stddev,
    count: n,
  };
}
