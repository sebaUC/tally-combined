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
