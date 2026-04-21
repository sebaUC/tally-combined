/**
 * Normaliza campos de una transacción para llenar las columnas:
 *   raw_description, merchant_name, auto_categorized, name.
 *
 * Funciona tanto con inputs de chat (usuario escribe "gasté 5k en lider")
 * como con payloads de Fintoc (description del banco estilo "COMPRA NAC LIDER").
 *
 * Implementación rule-based (regex + catálogo). El parser ML real
 * reemplazará `inferMerchant` / `inferCategoryFromMerchant` más adelante.
 */

interface MerchantRule {
  pattern: RegExp;
  merchant: string;
  category: string;
}

const MERCHANT_CATALOG: MerchantRule[] = [
  // Supermercados
  { pattern: /\blider\b/i, merchant: 'Lider', category: 'Supermercado' },
  { pattern: /\bjumbo\b/i, merchant: 'Jumbo', category: 'Supermercado' },
  { pattern: /\bunimarc\b/i, merchant: 'Unimarc', category: 'Supermercado' },
  { pattern: /\btottus\b/i, merchant: 'Tottus', category: 'Supermercado' },
  { pattern: /\bekono\b/i, merchant: 'Ekono', category: 'Supermercado' },
  {
    pattern: /\bsanta\s?isabel\b/i,
    merchant: 'Santa Isabel',
    category: 'Supermercado',
  },
  { pattern: /\balvi\b/i, merchant: 'Alvi', category: 'Supermercado' },

  // Delivery (antes que "uber" solo → para que uber eats gane)
  { pattern: /\buber\s*eats\b/i, merchant: 'Uber Eats', category: 'Delivery' },
  { pattern: /\brappi\b/i, merchant: 'Rappi', category: 'Delivery' },
  { pattern: /\bpedidos\s?ya\b/i, merchant: 'PedidosYa', category: 'Delivery' },
  { pattern: /\bjusto\b/i, merchant: 'Justo', category: 'Delivery' },
  { pattern: /\bcornershop\b/i, merchant: 'Cornershop', category: 'Delivery' },

  // Transporte
  { pattern: /\buber\b/i, merchant: 'Uber', category: 'Transporte' },
  { pattern: /\bdidi\b/i, merchant: 'DiDi', category: 'Transporte' },
  { pattern: /\bcabify\b/i, merchant: 'Cabify', category: 'Transporte' },
  { pattern: /\bbip\b/i, merchant: 'Bip!', category: 'Transporte' },

  // Bencina
  { pattern: /\bcopec\b/i, merchant: 'Copec', category: 'Bencina' },
  { pattern: /\bshell\b/i, merchant: 'Shell', category: 'Bencina' },
  { pattern: /\bpetrobras\b/i, merchant: 'Petrobras', category: 'Bencina' },
  { pattern: /\benex\b/i, merchant: 'Enex', category: 'Bencina' },

  // Café
  { pattern: /\bstarbucks\b/i, merchant: 'Starbucks', category: 'Café' },
  { pattern: /\bjuan\s?valdez\b/i, merchant: 'Juan Valdez', category: 'Café' },
  {
    pattern: /\bcaf[eé]\s?altura\b/i,
    merchant: 'Café Altura',
    category: 'Café',
  },

  // Comida rápida
  {
    pattern: /\bmcdonald'?s?\b/i,
    merchant: "McDonald's",
    category: 'Comida rápida',
  },
  {
    pattern: /\bburger\s?king\b/i,
    merchant: 'Burger King',
    category: 'Comida rápida',
  },
  { pattern: /\bkfc\b/i, merchant: 'KFC', category: 'Comida rápida' },
  { pattern: /\bsubway\b/i, merchant: 'Subway', category: 'Comida rápida' },
  { pattern: /\bdominos?\b/i, merchant: "Domino's", category: 'Comida rápida' },
  {
    pattern: /\bpizza\s?hut\b/i,
    merchant: 'Pizza Hut',
    category: 'Comida rápida',
  },
  {
    pattern: /\bpedro\s?juan\s?(y\s?)?diego\b/i,
    merchant: 'Pedro Juan y Diego',
    category: 'Restaurante',
  },

  // Streaming / Suscripciones
  { pattern: /\bspotify\b/i, merchant: 'Spotify', category: 'Suscripción' },
  { pattern: /\bnetflix\b/i, merchant: 'Netflix', category: 'Suscripción' },
  {
    pattern: /\bdisney\s?\+?\b/i,
    merchant: 'Disney+',
    category: 'Suscripción',
  },
  { pattern: /\bhbo\b/i, merchant: 'HBO', category: 'Suscripción' },
  {
    pattern: /\bprime\s?video\b/i,
    merchant: 'Prime Video',
    category: 'Suscripción',
  },
  {
    pattern: /\bapple\s?(music|tv|one)\b/i,
    merchant: 'Apple',
    category: 'Suscripción',
  },
  {
    pattern: /\byoutube\s?premium\b/i,
    merchant: 'YouTube Premium',
    category: 'Suscripción',
  },
  { pattern: /\bchatgpt\b/i, merchant: 'ChatGPT', category: 'Suscripción' },
  { pattern: /\bclaude\b/i, merchant: 'Claude', category: 'Suscripción' },

  // Telco / servicios
  { pattern: /\bentel\b/i, merchant: 'Entel', category: 'Telefonía' },
  { pattern: /\bmovistar\b/i, merchant: 'Movistar', category: 'Telefonía' },
  { pattern: /\bwom\b/i, merchant: 'WOM', category: 'Telefonía' },
  { pattern: /\bclaro\b/i, merchant: 'Claro', category: 'Telefonía' },
  { pattern: /\bvtr\b/i, merchant: 'VTR', category: 'Internet' },
  { pattern: /\bgtd\b/i, merchant: 'GTD', category: 'Internet' },
  {
    pattern: /\bmundo\s?pacifico\b/i,
    merchant: 'Mundo Pacífico',
    category: 'Internet',
  },

  // Servicios básicos
  { pattern: /\benel\b/i, merchant: 'Enel', category: 'Servicios' },
  { pattern: /\bchilquinta\b/i, merchant: 'Chilquinta', category: 'Servicios' },
  {
    pattern: /\baguas\s?andinas\b/i,
    merchant: 'Aguas Andinas',
    category: 'Servicios',
  },
  { pattern: /\bessbio\b/i, merchant: 'Essbio', category: 'Servicios' },
  { pattern: /\bmetrogas\b/i, merchant: 'Metrogas', category: 'Servicios' },
  { pattern: /\blipigas\b/i, merchant: 'Lipigas', category: 'Servicios' },
  { pattern: /\babastible\b/i, merchant: 'Abastible', category: 'Servicios' },

  // Retail
  { pattern: /\bfalabella\b/i, merchant: 'Falabella', category: 'Retail' },
  { pattern: /\bripley\b/i, merchant: 'Ripley', category: 'Retail' },
  { pattern: /\bparis\b/i, merchant: 'Paris', category: 'Retail' },
  {
    pattern: /\bmercado\s?libre\b/i,
    merchant: 'Mercado Libre',
    category: 'Retail',
  },
  { pattern: /\bla\s?polar\b/i, merchant: 'La Polar', category: 'Retail' },
  { pattern: /\bhites\b/i, merchant: 'Hites', category: 'Retail' },
  { pattern: /\bikea\b/i, merchant: 'IKEA', category: 'Hogar' },
  { pattern: /\bsodimac\b/i, merchant: 'Sodimac', category: 'Hogar' },
  { pattern: /\beasy\b/i, merchant: 'Easy', category: 'Hogar' },

  // Farmacias / salud
  { pattern: /\bcruz\s?verde\b/i, merchant: 'Cruz Verde', category: 'Salud' },
  {
    pattern: /\bfarmacias?\s?ahumada\b|\bfasa\b/i,
    merchant: 'Farmacias Ahumada',
    category: 'Salud',
  },
  { pattern: /\bsalcobrand\b/i, merchant: 'Salcobrand', category: 'Salud' },

  // Tecnología
  {
    pattern: /\bapple\s?store\b/i,
    merchant: 'Apple Store',
    category: 'Tecnología',
  },
  {
    pattern: /\bpc\s?factory\b/i,
    merchant: 'PC Factory',
    category: 'Tecnología',
  },
  {
    pattern: /\bsp\s?digital\b/i,
    merchant: 'SP Digital',
    category: 'Tecnología',
  },
];

/**
 * Patrones genéricos usados por bancos chilenos para cargos con tarjeta.
 * Extraen el nombre del comercio sin necesidad de catálogo explícito.
 * Se aplican como fallback cuando MERCHANT_CATALOG no matchea.
 *
 * Los patrones están ordenados por especificidad: los más restrictivos primero.
 */
const GENERIC_MERCHANT_PATTERNS: RegExp[] = [
  // "Pago Recurrente Vd APPLE.COM/BILL" / "Pago Vd NETFLIX.COM"
  // El "Vd" identifica pago con débito (vendor). Capturamos hasta antes de "el <fecha>".
  /Pago\s+(?:Recurrente\s+)?Vd\s+([A-Z0-9*.\-& /%]+?)(?:\s+el\s+\d|\s+\d{2}\/\d{2}|$)/i,

  // BICE, Itaú: "Cargo por compra en LIDER el 05/04..."
  /Cargo\s+por\s+compra\s+en\s+([A-Z0-9*.\-& /]+?)\s+(?:el\s+\d|monto|$)/i,

  // BancoEstado: "COMPRA NAC 05/04 LIDER"
  /COMPRA\s+(?:NAC|INT)\s+\d{2}\/\d{2}\s+([A-Z0-9*.\-& /]+)/i,

  // "Compra en UNIMARC LAS CONDES"
  /\bCompra\s+en\s+([A-Z0-9*.\-& /]+?)(?:\s+el\s+|$)/i,

  // "Pago de SPOTIFY" / "Pago a ENTEL"
  /\bPago\s+(?:de\s+|a\s+)([A-Z0-9*.\-& /]+?)(?:\s+por|\s+el|$)/i,

  // "MERCADOPAGO*GLORIASUBWAY" → extraer el nombre tras el *
  /\bMERCADOPAGO\*([A-Z0-9 ]+)/i,

  // "MERPAGO*JOTA" (variante de Mercado Pago)
  /\bMERPAGO\*([A-Z0-9 ]+)/i,
];

/**
 * Limpia sufijos de dominio comunes para dejar el merchant core.
 * "APPLE.COM/BILL" → "Apple", "NETFLIX.COM" → "Netflix"
 */
function stripDomainSuffix(merchant: string): string {
  return merchant
    .replace(/\.(com|cl|org|net|io)(\/\w+)?/gi, '')
    .replace(/%2f\w+/gi, '') // URL-encoded "/bill" etc
    .trim();
}

/**
 * Detecta transferencias entre personas / cuentas.
 * No tienen merchant (son a personas, no comercios).
 */
const TRANSFER_PATTERNS: RegExp[] = [
  /\bTransferencia\s+(?:de|a|desde|hacia)\b/i,
  /\bTransferencia\s+de\s+Fondos\b/i,
  /\bTraspaso\b/i,
];

function isTransferDescription(text: string): boolean {
  return TRANSFER_PATTERNS.some((r) => r.test(text));
}

function cleanMerchantName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Title case
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function inferMerchant(text: string | null | undefined): string | null {
  if (!text) return null;

  // Transfers nunca tienen merchant
  if (isTransferDescription(text)) return null;

  // 1. Catálogo explícito (alta confianza, marca conocida)
  const catalogMatch = MERCHANT_CATALOG.find((m) => m.pattern.test(text));
  if (catalogMatch) return catalogMatch.merchant;

  // 2. Patrón genérico de "Cargo por compra en X" / "Pago Vd X" / etc
  for (const pattern of GENERIC_MERCHANT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const stripped = stripDomainSuffix(match[1]);
      const candidate = cleanMerchantName(stripped);
      // Evitar basura de <3 chars
      if (candidate.length >= 3) {
        // Antes de devolver, verificar una vez más contra catálogo
        // (ej: extrajo "APPLE.COM/BILL" → stripped="APPLE" → match con catálogo)
        const hit = MERCHANT_CATALOG.find((m) => m.pattern.test(candidate));
        if (hit) return hit.merchant;
        return candidate;
      }
    }
  }

  return null;
}

export function inferCategoryFromMerchant(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  if (isTransferDescription(text)) return 'Transferencia';
  const match = MERCHANT_CATALOG.find((m) => m.pattern.test(text));
  return match?.category ?? null;
}

function titleCase(w: string): string {
  if (!w) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Genera un name legible (title-case, max 4 palabras).
 * Prioridad: merchant inferido > primeras palabras del description > category > fallback.
 */
export function generateTransactionName(opts: {
  category?: string | null;
  description?: string | null;
  merchant?: string | null;
  fallback?: string;
}): string {
  if (opts.merchant) return opts.merchant;

  if (opts.description) {
    const words = opts.description.trim().split(/\s+/).slice(0, 4);
    if (words.length && words[0].length > 1) {
      return words.map(titleCase).join(' ');
    }
  }

  if (opts.category) {
    return opts.category.split(/\s+/).map(titleCase).join(' ');
  }

  return opts.fallback ?? 'Transacción';
}

export interface NormalizedFields {
  raw_description: string | null;
  merchant_name: string | null;
  auto_categorized: boolean;
  name: string;
  inferred_category: string | null;
}

/**
 * Retorna los campos normalizados para insertar en `transactions`.
 *
 * @param input.description   Texto libre (del banco para Fintoc, del usuario para chat).
 * @param input.userCategory  Categoría que el usuario dio explícitamente (null si no).
 * @param input.explicitName  Nombre forzado por el usuario (opcional).
 * @param input.fallbackName  Nombre por defecto si no podemos derivar ninguno (ej: "Gasto", "Ingreso").
 */
export function normalizeTransactionFields(input: {
  description?: string | null;
  userCategory?: string | null;
  explicitName?: string | null;
  fallbackName?: string;
}): NormalizedFields {
  const rawDescription = input.description?.trim() || null;
  const userCategory = input.userCategory?.trim() || null;

  const merchantName = inferMerchant(rawDescription);
  const inferredCategory = inferCategoryFromMerchant(rawDescription);

  // auto_categorized = true si el sistema infirió la categoría sin que el usuario la diera
  const autoCategorized = !userCategory && !!inferredCategory;

  const name =
    input.explicitName?.trim() ||
    generateTransactionName({
      category: userCategory || inferredCategory,
      description: rawDescription,
      merchant: merchantName,
      fallback: input.fallbackName,
    });

  return {
    raw_description: rawDescription,
    merchant_name: merchantName,
    auto_categorized: autoCategorized,
    name,
    inferred_category: inferredCategory,
  };
}
