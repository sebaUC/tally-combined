/** Chile timestamp with timezone offset (e.g. 2026-03-26T17:30:00-03:00) */
export function getChileTimestamp(): string {
  const d = new Date();
  const local = d
    .toLocaleString('sv-SE', { timeZone: 'America/Santiago' })
    .replace(' ', 'T');
  const parts = d.toLocaleString('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'shortOffset',
  });
  const offset = parts.match(/GMT([+-]\d+)/)?.[1] || '-3';
  const hours = parseInt(offset);
  const offsetStr =
    (hours < 0 ? '-' : '+') + String(Math.abs(hours)).padStart(2, '0') + ':00';
  return local + offsetStr;
}

/** ISO of Chile-day midnight, expressed in UTC. Example: if it's 2026-04-25 14:00 in Chile,
 * returns the UTC instant for 2026-04-25T00:00:00-04:00. Used as `gte('posted_at', ...)` filter. */
export function startOfChileDayInUtc(): string {
  const now = new Date();
  const chileDate = now.toLocaleString('sv-SE', {
    timeZone: 'America/Santiago',
  }); // "2026-04-25 14:30:12"
  const ymd = chileDate.split(' ')[0]; // "2026-04-25"
  // Compute the offset Chile vs UTC right now (DST-aware via Intl).
  const offsetParts = now.toLocaleString('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'shortOffset',
  });
  const offsetH = parseInt(offsetParts.match(/GMT([+-]\d+)/)?.[1] || '-3', 10);
  const sign = offsetH < 0 ? '-' : '+';
  const hh = String(Math.abs(offsetH)).padStart(2, '0');
  return new Date(`${ymd}T00:00:00${sign}${hh}:00`).toISOString();
}

/** Format an ISO timestamp as Chile-time HH:MM (24h). Returns "—" if invalid. */
export function formatChileTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Format an ISO timestamp as Chile-date "DD/MM HH:MM". Returns "—" if invalid. */
export function formatChileDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
  });
  const time = formatChileTime(iso);
  return `${date} ${time}`;
}

/**
 * Extrae la hora real de la transacción del raw_description cuando el banco
 * la incluye en formato libre. Hoy soporta el patrón Banco BICE:
 *
 *   "Cargo por compra en {MERCHANT} el DD/MM/YYYY a las HH:MM:SS hrs., monto N."
 *   "Transferencia ... el DD/MM/YYYY a las HH:MM:SS."
 *
 * Devuelve un ISO con offset Chile (UTC-4 o -3 según DST) o null si no hay match.
 * La hora extraída se asume Chile-time (es lo que el banco muestra al cliente).
 */
export function extractRealTimestampFromRaw(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const m = raw.match(
    /el\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/i,
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const offsetH = chileOffsetHoursFor(`${yyyy}-${mm}-${dd}`);
  const sign = offsetH < 0 ? '-' : '+';
  const oh = String(Math.abs(offsetH)).padStart(2, '0');
  const iso = `${yyyy}-${mm}-${dd}T${hh.padStart(2, '0')}:${mi}:${ss ?? '00'}${sign}${oh}:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Offset Chile (en horas, signed) para una fecha YYYY-MM-DD dada. DST-aware. */
function chileOffsetHoursFor(ymd: string): number {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const parts = probe.toLocaleString('en-US', {
    timeZone: 'America/Santiago',
    timeZoneName: 'shortOffset',
  });
  const m = parts.match(/GMT([+-]\d+)/);
  return m ? parseInt(m[1], 10) : -4;
}

export type EffectiveTimestampSource =
  | 'transaction_at'
  | 'raw_extracted'
  | 'posted_at'
  | 'none';

export interface EffectiveTimestamp {
  iso: string | null;
  source: EffectiveTimestampSource;
  isFuturePost: boolean;
}

/**
 * "Mejor" timestamp para un movement de cuenta bancaria, en orden:
 *   1. transaction_at (si no es futuro)
 *   2. hora extraída del raw_description (BICE pattern)
 *   3. posted_at (con flag isFuturePost si está en el futuro)
 *   4. null
 *
 * Helper reservado para futuras integraciones con providers bancarios.
 */
export function effectiveMovementTimestamp(
  transactionAt: string | null | undefined,
  postedAt: string | null | undefined,
  rawDescription: string | null | undefined,
): EffectiveTimestamp {
  const now = Date.now();

  if (transactionAt) {
    const t = new Date(transactionAt).getTime();
    if (!isNaN(t) && t <= now) {
      return { iso: transactionAt, source: 'transaction_at', isFuturePost: false };
    }
  }
  const fromRaw = extractRealTimestampFromRaw(rawDescription);
  if (fromRaw) {
    return { iso: fromRaw, source: 'raw_extracted', isFuturePost: false };
  }
  if (postedAt) {
    const isFuture = new Date(postedAt).getTime() > now;
    return { iso: postedAt, source: 'posted_at', isFuturePost: isFuture };
  }
  return { iso: null, source: 'none', isFuturePost: false };
}
