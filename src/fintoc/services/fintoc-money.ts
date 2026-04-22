/**
 * Conversión de unidades monetarias devueltas por la API de Fintoc
 * al valor en "unidades mayores" (pesos, dólares, euros, etc).
 *
 * Fintoc devuelve el monto en la **unidad menor** de la moneda:
 *  - CLP: peso (sin decimales). amount=1317 ⇒ $1.317
 *  - USD: centavo. amount=1317 ⇒ $13,17
 *  - EUR: céntimo. amount=1317 ⇒ €13,17
 *
 * Fuente: https://docs.fintoc.com/reference/accounts-list
 * (en monedas sin decimales el "minor unit" == "major unit")
 */

const MINOR_UNITS_PER_MAJOR: Record<string, number> = {
  CLP: 1, // sin decimales
  USD: 100,
  EUR: 100,
  GBP: 100,
  ARS: 100,
  MXN: 100,
  PEN: 100,
  COP: 100,
};

function divisorFor(currency: string | null | undefined): number {
  if (!currency) return 1;
  return MINOR_UNITS_PER_MAJOR[currency.toUpperCase()] ?? 1;
}

/**
 * Convierte un monto en unidad menor (devuelto por Fintoc) a unidad mayor.
 * Preserva el signo: gasto negativo sigue siendo negativo.
 */
export function fromFintocMinorUnits(
  amount: number,
  currency: string,
): number {
  if (!Number.isFinite(amount)) return 0;
  return amount / divisorFor(currency);
}

/**
 * Convierte una unidad mayor de vuelta a unidad menor (útil para balances).
 */
export function toFintocMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * divisorFor(currency));
}
