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
