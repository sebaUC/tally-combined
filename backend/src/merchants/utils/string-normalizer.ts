/**
 * Utilities for cleaning raw bank strings before merchant lookup.
 */

const TRANSFER_PATTERNS: RegExp[] = [
  /\bTransferencia\s+(?:de|a|desde|hacia)\b/i,
  /\bTransferencia\s+de\s+Fondos\b/i,
  /\bTraspaso\b/i,
];

/**
 * Transfers between people/accounts have no merchant.
 * The resolver short-circuits to source='none' when true.
 */
export function isTransferDescription(text: string): boolean {
  return TRANSFER_PATTERNS.some((r) => r.test(text));
}

/**
 * Strips common domain suffixes to reveal the merchant core.
 *   "APPLE.COM/BILL" -> "Apple"
 *   "NETFLIX.COM"    -> "Netflix"
 */
export function stripDomainSuffix(merchant: string): string {
  return merchant
    .replace(/\.(com|cl|org|net|io)(\/\w+)?/gi, '')
    .replace(/%2f\w+/gi, '')
    .trim();
}

/**
 * Normalizes whitespace/separators and title-cases.
 *   "LIDER   PROVIDENCIA" -> "Lider Providencia"
 */
export function cleanMerchantName(raw: string): string {
  return raw
    .trim()
    .replace(/[*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
