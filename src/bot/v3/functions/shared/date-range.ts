export interface DateRange {
  start: string;
  end: string;
  label: string;
}

export function getDateRange(
  period: string,
  startDate?: string,
  endDate?: string,
): DateRange {
  const now = new Date();

  switch (period) {
    case 'today': {
      const d = now.toLocaleDateString('sv-SE', {
        timeZone: 'America/Santiago',
      });
      return { start: `${d}T00:00:00`, end: `${d}T23:59:59`, label: 'hoy' };
    }
    case 'week': {
      const day = now.getDay();
      const mondayOffset = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - mondayOffset);
      return {
        start:
          monday.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) +
          'T00:00:00',
        end:
          now.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) +
          'T23:59:59',
        label: 'esta semana',
      };
    }
    case 'year': {
      const d = now.toLocaleDateString('sv-SE', {
        timeZone: 'America/Santiago',
      });
      const y = d.split('-')[0];
      return {
        start: `${y}-01-01T00:00:00`,
        end: `${y}-12-31T23:59:59`,
        label: y,
      };
    }
    case 'custom': {
      return {
        start: startDate
          ? `${startDate}T00:00:00`
          : `${now.getFullYear()}-01-01T00:00:00`,
        end: endDate ? `${endDate}T23:59:59` : now.toISOString(),
        label: `${startDate || 'inicio'} al ${endDate || 'hoy'}`,
      };
    }
    default: {
      // month
      const d = now.toLocaleDateString('sv-SE', {
        timeZone: 'America/Santiago',
      });
      const [y, m] = d.split('-');
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      return {
        start: `${y}-${m}-01T00:00:00`,
        end: `${y}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59`,
        label: now.toLocaleDateString('es-CL', {
          month: 'long',
          year: 'numeric',
          timeZone: 'America/Santiago',
        }),
      };
    }
  }
}
