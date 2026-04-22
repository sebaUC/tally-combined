/**
 * Builds the proactive Telegram summary Gus sends after a Fintoc sync.
 *
 * Tone: casual, Chilean-friendly, with a subtle "Gus knows what he's doing"
 * technical footer. Output is HTML (Telegram parseMode).
 *
 * Content shape (omits sections with no data):
 *
 *   🏦 <b>Listo, revisé tu banco.</b>
 *
 *   📊 5 movimientos nuevos
 *   💸 Gastaste $23.450 en 3 movs
 *   💰 Recibiste $450.000 en 2 movs
 *
 *   <b>Tus comercios top:</b>
 *   🛒 Lider — $12.500
 *   ⛽ Copec — $8.950
 *
 *   ✨ Descubrí 2 comercios nuevos: Pedro Juan y Diego, SP Digital
 *
 *   <i>(Reconocí 4/5 con el catálogo, 1 con IA)</i>
 */

export interface SyncSummaryInput {
  totalInserted: number;
  totalSpent: number; // CLP positive
  expenseCount: number;
  totalIncome: number; // CLP positive
  incomeCount: number;
  topMerchants: Array<{
    name: string;
    amount: number;
    icon: string | null;
  }>;
  newMerchantsDiscovered: string[]; // names of merchants created by LLM
  resolverBreakdown: Record<string, number>; // source → count
  institutionName: string | null;
}

/**
 * Returns an HTML-formatted Telegram message, or null when there's nothing
 * worth reporting (0 new transactions).
 */
export function buildSyncSummary(input: SyncSummaryInput): string | null {
  if (input.totalInserted === 0) return null;

  const lines: string[] = [];

  // Header
  const bank = input.institutionName ? ` de ${escape(input.institutionName)}` : '';
  lines.push(`🏦 <b>Listo, revisé tu cuenta${bank}.</b>`);
  lines.push('');

  // Count
  const noun = input.totalInserted === 1 ? 'movimiento nuevo' : 'movimientos nuevos';
  lines.push(`📊 <b>${input.totalInserted}</b> ${noun}`);

  if (input.expenseCount > 0) {
    lines.push(
      `💸 Gastaste ${fmt(input.totalSpent)} en ${input.expenseCount} ${
        input.expenseCount === 1 ? 'mov' : 'movs'
      }`,
    );
  }
  if (input.incomeCount > 0) {
    lines.push(
      `💰 Recibiste ${fmt(input.totalIncome)} en ${input.incomeCount} ${
        input.incomeCount === 1 ? 'mov' : 'movs'
      }`,
    );
  }

  // Top merchants
  if (input.topMerchants.length > 0) {
    lines.push('');
    lines.push('<b>Tus comercios top:</b>');
    for (const m of input.topMerchants.slice(0, 3)) {
      const icon = m.icon ? `${m.icon} ` : '• ';
      lines.push(`${icon}${escape(m.name)} — ${fmt(m.amount)}`);
    }
  }

  // New merchants discovered
  if (input.newMerchantsDiscovered.length > 0) {
    lines.push('');
    const names = input.newMerchantsDiscovered.slice(0, 5).map(escape).join(', ');
    const count = input.newMerchantsDiscovered.length;
    const word = count === 1 ? 'comercio nuevo' : 'comercios nuevos';
    lines.push(`✨ Descubrí ${count} ${word}: ${names}`);
  }

  // Technical footer (debug-style, casual)
  const footer = buildResolverFooter(input.resolverBreakdown, input.totalInserted);
  if (footer) {
    lines.push('');
    lines.push(`<i>${footer}</i>`);
  }

  return lines.join('\n');
}

// ── internals ─────────────────────────────────────────────────────

function buildResolverFooter(
  breakdown: Record<string, number>,
  totalInserted: number,
): string | null {
  const catalog = breakdown.catalog ?? 0;
  const trgm = breakdown.trgm ?? 0;
  const embedding = breakdown.embedding ?? 0;
  const llm = breakdown.llm ?? 0;
  const none = breakdown.none ?? 0;

  const identified = catalog + trgm + embedding + llm;
  const total = identified + none;
  if (total === 0) return null;

  const parts: string[] = [];
  if (catalog > 0) parts.push(`${catalog} por catálogo`);
  if (trgm > 0) parts.push(`${trgm} por similitud`);
  if (embedding > 0) parts.push(`${embedding} por significado`);
  if (llm > 0) parts.push(`${llm} con IA`);

  if (parts.length === 0) {
    // Only "none" hits
    return `(Este banco me mandó ${none} movs sin comercio claro)`;
  }

  const identifiedText = `Reconocí ${identified}/${totalInserted} comercios`;
  const breakdownText = parts.join(', ');
  return `(${identifiedText}: ${breakdownText})`;
}

/** Format CLP amount with thousands separator. */
function fmt(amount: number): string {
  const n = Math.round(Math.abs(amount));
  return `$${n.toLocaleString('es-CL')}`;
}

/** Escape HTML entities for Telegram parse_mode=HTML. */
function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
