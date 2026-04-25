// Render preview de los escenarios del nudge post-sync (debug verbose).
// Inlina helpers para correr standalone (sin compilar TS).

function formatChileTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function formatChileDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('es-CL', {
    timeZone: 'America/Santiago', day: '2-digit', month: '2-digit',
  });
  return `${date} ${formatChileTime(iso)}`;
}
function fmt(n) { return `$${Math.round(Math.abs(n)).toLocaleString('es-CL')}`; }
function escape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function truncate(s, max) { return s.length <= max ? s : s.slice(0, max - 1) + '…'; }
function labelResolver(source) {
  switch (source) {
    case 'catalog':   return '<b>catalog</b> ✓ (match exacto en catálogo)';
    case 'trgm':      return '<b>trgm</b> ✓ (similitud difusa)';
    case 'embedding': return '<b>embedding</b> ✓ (significado semántico)';
    case 'llm':       return '<b>llm</b> ✓ (IA — comercio nuevo)';
    case 'none':      return '<b>none</b> ✗ (ningún resolver hizo match)';
    case null: case undefined: return '<i>sin resolver_source</i>';
    default: return `<b>${escape(source)}</b>`;
  }
}
function formatMovementDebug(m) {
  const time = formatChileTime(m.postedAt);
  const sign = m.type === 'income' ? '+' : '−';
  const amount = `${sign}${fmt(m.amount)}`;
  const merchantIcon = m.icon ? `${m.icon} ` : (m.type === 'income' ? '➕ ' : '🧾 ');
  const cat = m.categoryName ? escape(m.categoryName) : '<i>sin categoría</i>';
  const resolver = labelResolver(m.resolverSource);
  const raw = m.rawDescription ? `<code>${escape(truncate(m.rawDescription, 60))}</code>` : '<i>(sin raw)</i>';
  return [
    '',
    `${merchantIcon}<b>${time}</b> · ${amount}`,
    `   📥 raw: ${raw}`,
    `   🔍 resolver: ${resolver}`,
    `   🏪 comercio: <b>${escape(m.merchantName)}</b>`,
    `   🏷️ categoría: ${cat}`,
  ].join('\n');
}
function buildResolverFooter(b, totalInserted) {
  const c=b.catalog??0,t=b.trgm??0,e=b.embedding??0,l=b.llm??0,n=b.none??0;
  const id=c+t+e+l;
  if (id+n===0) return null;
  const parts=[];
  if (c) parts.push(`${c} catálogo`);
  if (t) parts.push(`${t} similitud`);
  if (e) parts.push(`${e} significado`);
  if (l) parts.push(`${l} IA`);
  if (n) parts.push(`${n} sin match`);
  return `Resolver: ${parts.join(' · ')} (${id}/${totalInserted} resueltos)`;
}
function buildSyncSummary(input) {
  const lines = [];
  const bank = input.institutionName ? ` de ${escape(input.institutionName)}` : '';
  const time = formatChileTime(input.syncCompletedAt.toISOString());

  if (input.totalInserted > 0) {
    lines.push(`🏦 <b>Refresh${bank}</b> · ${time}`);
    lines.push('');
    const noun = input.totalInserted === 1 ? 'movimiento nuevo' : 'movimientos nuevos';
    lines.push(`📊 <b>${input.totalInserted}</b> ${noun}`);
    if (input.expenseCount > 0)
      lines.push(`💸 Gasto: ${fmt(input.totalSpent)} en ${input.expenseCount} ${input.expenseCount === 1 ? 'mov' : 'movs'}`);
    if (input.incomeCount > 0)
      lines.push(`💰 Ingreso: ${fmt(input.totalIncome)} en ${input.incomeCount} ${input.incomeCount === 1 ? 'mov' : 'movs'}`);

    if (input.newMovements.length > 0) {
      lines.push('');
      lines.push('<b>Detalle por movimiento:</b>');
      for (const m of input.newMovements.slice(0, 6)) lines.push(formatMovementDebug(m));
      if (input.newMovements.length > 6) {
        lines.push('');
        lines.push(`<i>… y ${input.newMovements.length - 6} más (cap del mensaje)</i>`);
      }
    }
    if (input.newMerchantsDiscovered.length > 0) {
      lines.push('');
      const names = input.newMerchantsDiscovered.slice(0, 5).map(escape).join(', ');
      const c = input.newMerchantsDiscovered.length;
      lines.push(`✨ Descubrí ${c} ${c === 1 ? 'comercio nuevo' : 'comercios nuevos'}: ${names}`);
    }
  } else {
    lines.push(`💳 <b>Refresh${bank}</b> · sync ${time}`);
    lines.push('');
    lines.push('🟢 Pipeline OK — webhook recibido, sync ejecutado, cero movs nuevos.');
    if (input.lastSeenTx) {
      const t = formatChileDateTime(input.lastSeenTx.postedAt);
      const sign = input.lastSeenTx.type === 'income' ? '+' : '−';
      lines.push('');
      lines.push(`<b>Último mov visto:</b> ${escape(input.lastSeenTx.merchantName)} ${sign}${fmt(input.lastSeenTx.amount)} · ${t}`);
    }
  }

  lines.push('');
  lines.push('<b>📅 Hoy:</b>');
  if (input.todayTotals.expenseCount > 0) {
    lines.push(`   Gasto: ${fmt(input.todayTotals.totalSpent)} en ${input.todayTotals.expenseCount} ${input.todayTotals.expenseCount === 1 ? 'mov' : 'movs'}`);
  } else {
    lines.push('   Gasto: $0');
  }
  if (input.todayTotals.incomeCount > 0) {
    lines.push(`   Ingreso: ${fmt(input.todayTotals.totalIncome)} en ${input.todayTotals.incomeCount} ${input.todayTotals.incomeCount === 1 ? 'mov' : 'movs'}`);
  }

  const footer = buildResolverFooter(input.resolverBreakdown, input.totalInserted);
  if (footer) {
    lines.push('');
    lines.push(`<i>${footer}</i>`);
  }

  return lines.join('\n');
}

function box(title, body) {
  const sep = '─'.repeat(70);
  console.log(`\n${sep}\n  ${title}\n${sep}`);
  console.log(body);
  console.log(sep + '\n');
}
function dt(hh, mm) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  return new Date(`${today}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00-04:00`).toISOString();
}

// ── CASO A — sync típico con 2 gastos ─────────────────────────────
box('CASO A — 2 gastos nuevos (debug verbose)', buildSyncSummary({
  totalInserted: 2,
  totalSpent: 20450, expenseCount: 2, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Lider', amount: 12500, type: 'expense',
      postedAt: dt(14,8), icon: '🛒',
      resolverSource: 'catalog',
      rawDescription: 'COMPRA TBK*LIDER QUILICURA 2104',
      categoryName: 'Supermercado',
    },
    {
      merchantName: 'Copec', amount: 7950, type: 'expense',
      postedAt: dt(13,42), icon: '⛽',
      resolverSource: 'trgm',
      rawDescription: 'COMPRA TBK*COPECMAIPU3829OCTUBRE',
      categoryName: 'Bencina',
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { catalog: 1, trgm: 1 },
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 34200, expenseCount: 4, totalIncome: 1250000, incomeCount: 1 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO B — gasto desconocido resuelto por LLM ───────────────────
box('CASO B — comercio nuevo descubierto por IA (LLM)', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 4500, expenseCount: 1, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Lime Viajes', amount: 4500, type: 'expense',
      postedAt: dt(13,55), icon: null,
      resolverSource: 'llm',
      rawDescription: 'TBK*LIMEVIAJESJKJ8392N',
      categoryName: 'Transporte',
    },
  ],
  newMerchantsDiscovered: ['Lime Viajes'],
  resolverBreakdown: { llm: 1 },
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 4500, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO C — gasto sin match (none) — debug muestra el fallo ──────
box('CASO C — comercio sin resolver (none) — debug crucial', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 8900, expenseCount: 1, totalIncome: 0, incomeCount: 0,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'TRAS BANR EST 32918',  // fallback corto
      amount: 8900, type: 'expense',
      postedAt: dt(11,15), icon: null,
      resolverSource: 'none',
      rawDescription: 'TRAS BANR EST 32918  ABONO PR',
      categoryName: null,
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { none: 1 },
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 8900, expenseCount: 1, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO D — sueldo (income) ──────────────────────────────────────
box('CASO D — ingreso (sueldo)', buildSyncSummary({
  totalInserted: 1,
  totalSpent: 0, expenseCount: 0, totalIncome: 1250000, incomeCount: 1,
  topMerchants: [],
  newMovements: [
    {
      merchantName: 'Sueldo - Empresa SpA', amount: 1250000, type: 'income',
      postedAt: dt(7,30), icon: '💰',
      resolverSource: 'catalog',
      rawDescription: 'TRANSF SPV NOMINA SUELDO ABR2026',
      categoryName: 'Sueldo',
    },
  ],
  newMerchantsDiscovered: [],
  resolverBreakdown: { catalog: 1 },
  institutionName: 'Banco de Chile',
  todayTotals: { totalSpent: 0, expenseCount: 0, totalIncome: 1250000, incomeCount: 1 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO E — heartbeat (sin movs nuevos) — pipeline OK ────────────
box('CASO E — heartbeat con resumen del día (antes era silencio)', buildSyncSummary({
  totalInserted: 0,
  totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0,
  topMerchants: [], newMovements: [], newMerchantsDiscovered: [],
  resolverBreakdown: {},
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 34200, expenseCount: 4, totalIncome: 1250000, incomeCount: 1 },
  lastSeenTx: { merchantName: 'Lider', amount: 12500, type: 'expense', postedAt: dt(14,8) },
  syncCompletedAt: new Date(),
}));

// ── CASO F — heartbeat absoluto (día sin nada) ────────────────────
box('CASO F — heartbeat sin movs hoy ni último visto', buildSyncSummary({
  totalInserted: 0,
  totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0,
  topMerchants: [], newMovements: [], newMerchantsDiscovered: [],
  resolverBreakdown: {},
  institutionName: null,
  todayTotals: { totalSpent: 0, expenseCount: 0, totalIncome: 0, incomeCount: 0 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));

// ── CASO G — sync masivo con todas las layers + categoría faltante ──
box('CASO G — 7 movs (mezcla de resolvers, una sin categoría)', buildSyncSummary({
  totalInserted: 7,
  totalSpent: 78850, expenseCount: 6, totalIncome: 50000, incomeCount: 1,
  topMerchants: [],
  newMovements: [
    { merchantName: 'Lider', amount: 18500, type: 'expense', postedAt: dt(20,5),  icon: '🛒', resolverSource: 'catalog',   rawDescription: 'TBK*LIDER QUILICURA',         categoryName: 'Supermercado' },
    { merchantName: 'Uber',  amount: 4200,  type: 'expense', postedAt: dt(19,30), icon: '🚗', resolverSource: 'catalog',   rawDescription: 'UBER *RIDES',                 categoryName: 'Transporte' },
    { merchantName: 'Copec', amount: 12000, type: 'expense', postedAt: dt(18,15), icon: '⛽', resolverSource: 'trgm',      rawDescription: 'COPECMAIPU 3829',             categoryName: 'Bencina' },
    { merchantName: 'PedidosYa', amount: 9100, type: 'expense', postedAt: dt(13,0), icon: '🍕', resolverSource: 'embedding', rawDescription: 'PYAOOO 4824 ENTREGAS',        categoryName: 'Delivery' },
    { merchantName: 'Café Los Andes', amount: 6000, type: 'expense', postedAt: dt(10,15), icon: '☕', resolverSource: 'llm', rawDescription: 'TBK*CAFELOSANDESLTDA',        categoryName: 'Café' },
    { merchantName: 'TRANSF 4829', amount: 29050, type: 'expense', postedAt: dt(9,30), icon: null, resolverSource: 'none', rawDescription: 'TRASPASO INTERBAN 4829 ABR', categoryName: null },
    { merchantName: 'Devolución MercadoLibre', amount: 50000, type: 'income', postedAt: dt(16,45), icon: '➕', resolverSource: 'catalog', rawDescription: 'TRANSF MERCADO LIBRE DEV', categoryName: 'Reembolsos' },
  ],
  newMerchantsDiscovered: ['Café Los Andes'],
  resolverBreakdown: { catalog: 3, trgm: 1, embedding: 1, llm: 1, none: 1 },
  institutionName: 'Banco Estado',
  todayTotals: { totalSpent: 78850, expenseCount: 6, totalIncome: 50000, incomeCount: 1 },
  lastSeenTx: null,
  syncCompletedAt: new Date(),
}));
