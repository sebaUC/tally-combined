/**
 * Builds the proactive Telegram summary Gus sends after a Fintoc sync.
 *
 * Always emits a meaningful message — including when there are no new
 * transactions (debug heartbeat with today's totals + last seen tx).
 *
 * Tone: casual, Chilean-friendly, with a subtle "Gus knows what he's doing"
 * technical footer. Output is HTML (Telegram parseMode).
 */
import {
  formatChileTime,
  formatChileDateTime,
} from '../../bot/v3/functions/shared/chile-time';

export interface SyncSummaryInput {
  totalInserted: number;
  totalSpent: number; // CLP positive — agregado de movs nuevos
  expenseCount: number;
  totalIncome: number;
  incomeCount: number;
  topMerchants: Array<{
    name: string;
    amount: number;
    icon: string | null;
  }>;
  /** Cada movement nuevo, con timestamp en ISO (Fintoc post_date / transaction_date). */
  newMovements: Array<{
    merchantName: string;
    amount: number;
    type: 'expense' | 'income';
    postedAt: string | null;
    icon: string | null;
    resolverSource: string | null;
    rawDescription: string | null;
    categoryName: string | null;
  }>;
  newMerchantsDiscovered: string[];
  resolverBreakdown: Record<string, number>;
  institutionName: string | null;
  /** Acumulado del día actual (Chile-time) para este link. */
  todayTotals: {
    totalSpent: number;
    expenseCount: number;
    totalIncome: number;
    incomeCount: number;
  };
  /** Última tx vista en este link, para mostrar contexto en heartbeat. */
  lastSeenTx: {
    merchantName: string;
    amount: number;
    type: 'expense' | 'income';
    postedAt: string | null;
  } | null;
  /** Cuándo terminó el sync — se imprime en el header. */
  syncCompletedAt: Date;
}

/** Returns an HTML-formatted Telegram message. Always returns content. */
export function buildSyncSummary(input: SyncSummaryInput): string {
  const lines: string[] = [];

  const bank = input.institutionName ? ` de ${escape(input.institutionName)}` : '';
  const time = formatChileTime(input.syncCompletedAt.toISOString());

  if (input.totalInserted > 0) {
    lines.push(`🏦 <b>Refresh${bank}</b> · ${time}`);
    lines.push('');
    const noun = input.totalInserted === 1 ? 'movimiento nuevo' : 'movimientos nuevos';
    lines.push(`📊 <b>${input.totalInserted}</b> ${noun}`);

    if (input.expenseCount > 0) {
      lines.push(
        `💸 Gasto: ${fmt(input.totalSpent)} en ${input.expenseCount} ${
          input.expenseCount === 1 ? 'mov' : 'movs'
        }`,
      );
    }
    if (input.incomeCount > 0) {
      lines.push(
        `💰 Ingreso: ${fmt(input.totalIncome)} en ${input.incomeCount} ${
          input.incomeCount === 1 ? 'mov' : 'movs'
        }`,
      );
    }

    // Detalle por movement con debug completo (raw, resolver, comercio, categoría, hora).
    // Cap a 6 para no saturar Telegram (~4096 char limit, cada mov ocupa ~250 char).
    if (input.newMovements.length > 0) {
      lines.push('');
      lines.push('<b>Detalle por movimiento:</b>');
      for (const m of input.newMovements.slice(0, 6)) {
        lines.push(formatMovementDebug(m));
      }
      if (input.newMovements.length > 6) {
        lines.push('');
        lines.push(`<i>… y ${input.newMovements.length - 6} más (cap del mensaje)</i>`);
      }
    }

    if (input.newMerchantsDiscovered.length > 0) {
      lines.push('');
      const names = input.newMerchantsDiscovered.slice(0, 5).map(escape).join(', ');
      const count = input.newMerchantsDiscovered.length;
      const word = count === 1 ? 'comercio nuevo' : 'comercios nuevos';
      lines.push(`✨ Descubrí ${count} ${word}: ${names}`);
    }
  } else {
    lines.push(`💳 <b>Refresh${bank}</b> · sync ${time}`);
    lines.push('');
    lines.push('🟢 Pipeline OK — webhook recibido, sync ejecutado, cero movs nuevos.');
    if (input.lastSeenTx) {
      const t = formatChileDateTime(input.lastSeenTx.postedAt);
      const sign = input.lastSeenTx.type === 'income' ? '+' : '−';
      lines.push('');
      lines.push(
        `<b>Último mov visto:</b> ${escape(input.lastSeenTx.merchantName)} ${sign}${fmt(
          input.lastSeenTx.amount,
        )} · ${t}`,
      );
    }
  }

  // Acumulado del día (siempre)
  lines.push('');
  lines.push('<b>📅 Hoy:</b>');
  if (input.todayTotals.expenseCount > 0) {
    lines.push(
      `   Gasto: ${fmt(input.todayTotals.totalSpent)} en ${input.todayTotals.expenseCount} ${
        input.todayTotals.expenseCount === 1 ? 'mov' : 'movs'
      }`,
    );
  } else {
    lines.push('   Gasto: $0');
  }
  if (input.todayTotals.incomeCount > 0) {
    lines.push(
      `   Ingreso: ${fmt(input.todayTotals.totalIncome)} en ${input.todayTotals.incomeCount} ${
        input.todayTotals.incomeCount === 1 ? 'mov' : 'movs'
      }`,
    );
  }

  // Footer técnico (resolver breakdown)
  const footer = buildResolverFooter(input.resolverBreakdown, input.totalInserted);
  if (footer) {
    lines.push('');
    lines.push(`<i>${footer}</i>`);
  }

  return lines.join('\n');
}

// ── internals ─────────────────────────────────────────────────────

/** Debug detallado por movement: hora · monto · raw · resolver · comercio · categoría. */
function formatMovementDebug(m: {
  merchantName: string;
  amount: number;
  type: 'expense' | 'income';
  postedAt: string | null;
  icon: string | null;
  resolverSource: string | null;
  rawDescription: string | null;
  categoryName: string | null;
}): string {
  const time = formatChileTime(m.postedAt);
  const sign = m.type === 'income' ? '+' : '−';
  const amount = `${sign}${fmt(m.amount)}`;
  const merchantIcon = m.icon ? `${m.icon} ` : m.type === 'income' ? '➕ ' : '🧾 ';
  const cat = m.categoryName ? escape(m.categoryName) : '<i>sin categoría</i>';
  const resolver = labelResolver(m.resolverSource);
  const raw = m.rawDescription
    ? `<code>${escape(truncate(m.rawDescription, 60))}</code>`
    : '<i>(sin raw)</i>';

  return [
    '',
    `${merchantIcon}<b>${time}</b> · ${amount}`,
    `   📥 raw: ${raw}`,
    `   🔍 resolver: ${resolver}`,
    `   🏪 comercio: <b>${escape(m.merchantName)}</b>`,
    `   🏷️ categoría: ${cat}`,
  ].join('\n');
}

function labelResolver(source: string | null): string {
  switch (source) {
    case 'catalog':   return '<b>catalog</b> ✓ (match exacto en catálogo)';
    case 'trgm':      return '<b>trgm</b> ✓ (similitud difusa)';
    case 'embedding': return '<b>embedding</b> ✓ (significado semántico)';
    case 'llm':       return '<b>llm</b> ✓ (IA — comercio nuevo)';
    case 'none':      return '<b>none</b> ✗ (ningún resolver hizo match)';
    case null:
    case undefined:   return '<i>sin resolver_source</i>';
    default:          return `<b>${escape(source)}</b>`;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

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
  if (catalog > 0) parts.push(`${catalog} catálogo`);
  if (trgm > 0) parts.push(`${trgm} similitud`);
  if (embedding > 0) parts.push(`${embedding} significado`);
  if (llm > 0) parts.push(`${llm} IA`);
  if (none > 0) parts.push(`${none} sin match`);

  return `Resolver: ${parts.join(' · ')} (${identified}/${totalInserted} resueltos)`;
}

function fmt(amount: number): string {
  const n = Math.round(Math.abs(amount));
  return `$${n.toLocaleString('es-CL')}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
