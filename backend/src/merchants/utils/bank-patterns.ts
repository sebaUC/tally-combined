/**
 * Regex patterns that extract merchant names from raw bank descriptions.
 * Ordered from most specific to most generic. Applied as fallback parsing
 * before similarity matching.
 */
export const BANK_PATTERNS: RegExp[] = [
  // "Pago Recurrente Vd APPLE.COM/BILL" / "Pago Vd NETFLIX.COM"
  /Pago\s+(?:Recurrente\s+)?Vd\s+([A-Z0-9*.\-& /%]+?)(?:\s+el\s+\d|\s+\d{2}\/\d{2}|$)/i,

  // BICE, Itaú: "Cargo por compra en LIDER el 05/04..."
  /Cargo\s+por\s+compra\s+en\s+([A-Z0-9*.\-& /]+?)\s+(?:el\s+\d|monto|$)/i,

  // BancoEstado: "COMPRA NAC 05/04 LIDER"
  /COMPRA\s+(?:NAC|INT)\s+\d{2}\/\d{2}\s+([A-Z0-9*.\-& /]+)/i,

  // "Compra en UNIMARC LAS CONDES"
  /\bCompra\s+en\s+([A-Z0-9*.\-& /]+?)(?:\s+el\s+|$)/i,

  // "Pago de SPOTIFY" / "Pago a ENTEL"
  /\bPago\s+(?:de\s+|a\s+)([A-Z0-9*.\-& /]+?)(?:\s+por|\s+el|$)/i,

  // "MERCADOPAGO*GLORIASUBWAY"
  /\bMERCADOPAGO\*([A-Z0-9 ]+)/i,

  // "MERPAGO*JOTA"
  /\bMERPAGO\*([A-Z0-9 ]+)/i,
];

/**
 * Extracts a merchant candidate string from a raw bank description by
 * applying BANK_PATTERNS in order. Returns the first capture group that hits.
 */
export function extractMerchantCandidate(text: string): string | null {
  for (const pattern of BANK_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}
