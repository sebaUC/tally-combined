#!/usr/bin/env node
// Lightweight Supabase REST query tool — bypasses the MCP entirely.
// Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
//
// Examples:
//   node scripts/debug/db.mjs transactions --limit=5 --order=created_at.desc
//   node scripts/debug/db.mjs transactions --eq=user_id:UUID --select=id,amount,merchant_name --limit=10
//   node scripts/debug/db.mjs fintoc_access_log --order=created_at.desc --limit=20
//   node scripts/debug/db.mjs --schema                     (lista tablas conocidas)
//   node scripts/debug/db.mjs --rpc=match_merchant_trgm --json='{"q":"lider","threshold":0.5}'
//
// Filtros soportados (PostgREST): --eq, --neq, --gt, --gte, --lt, --lte, --in, --like, --is
// Cada uno: --eq=column:value (ej --eq=user_id:abc123)
// Múltiples del mismo tipo: --eq=col1:v1 --eq=col2:v2

import * as fs from 'node:fs';

// ── load .env ─────────────────────────────────────────────────────
const FOUND_KEYS = [];
try {
  const envRaw = fs.readFileSync('.env', 'utf8');
  for (const line of envRaw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      FOUND_KEYS.push(m[1]);
    }
  }
} catch (e) {
  console.error('No pude leer .env:', e.message);
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('FAIL: necesito SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env');
  console.error('  SUPABASE_URL=', url ? '✓' : '✗ falta');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=', key ? '✓' : '✗ falta');
  process.exit(1);
}

// ── parse args ────────────────────────────────────────────────────
const args = process.argv.slice(2);
let table = null;
let select = '*';
let limit = null;
let order = null;
let rpc = null;
let rpcJson = null;
let schemaOnly = false;
const filters = [];

const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'is'];

for (const a of args) {
  if (a === '--schema') { schemaOnly = true; continue; }
  if (a.startsWith('--limit=')) { limit = a.split('=')[1]; continue; }
  if (a.startsWith('--order=')) { order = a.split('=')[1]; continue; }
  if (a.startsWith('--select=')) { select = a.split('=')[1]; continue; }
  if (a.startsWith('--rpc=')) { rpc = a.split('=')[1]; continue; }
  if (a.startsWith('--json=')) { rpcJson = a.slice('--json='.length); continue; }
  let matched = false;
  for (const op of FILTER_OPS) {
    if (a.startsWith(`--${op}=`)) {
      const rest = a.slice(`--${op}=`.length);
      const idx = rest.indexOf(':');
      if (idx === -1) {
        console.error(`Filtro inválido: ${a} — formato: --${op}=column:value`);
        process.exit(1);
      }
      filters.push({ column: rest.slice(0, idx), op, value: rest.slice(idx + 1) });
      matched = true;
      break;
    }
  }
  if (matched) continue;
  if (a.startsWith('--')) {
    console.error(`Flag desconocido: ${a}`);
    process.exit(1);
  }
  if (!table) table = a;
}

// ── helpers ───────────────────────────────────────────────────────
function header(extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}
async function http(path, opts = {}) {
  const res = await fetch(`${url}/rest/v1${path}`, opts);
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  try { return JSON.parse(text); } catch { return text; }
}
function fmtRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('(0 rows)');
    return;
  }
  console.log(JSON.stringify(rows, null, 2));
  console.log(`\n→ ${rows.length} row${rows.length === 1 ? '' : 's'}`);
}

// ── run ───────────────────────────────────────────────────────────
if (schemaOnly) {
  console.log('Tablas conocidas en este proyecto (según CLAUDE.md):');
  for (const t of [
    'users', 'user_prefs', 'personality_snapshot',
    'channel_accounts', 'channel_link_codes',
    'transactions', 'categories', 'accounts',
    'income_expectations', 'spending_expectations', 'goals',
    'bot_message_log', 'my_sessions',
    'fintoc_links', 'fintoc_access_log',
    'merchants_global', 'user_merchant_preferences',
  ]) console.log(`  - ${t}`);
  console.log('\nUsa: node scripts/debug/db.mjs <tabla> --limit=N --order=col.desc');
  process.exit(0);
}

if (rpc) {
  const body = rpcJson ? JSON.parse(rpcJson) : {};
  const data = await http(`/rpc/${rpc}`, {
    method: 'POST',
    headers: header(),
    body: JSON.stringify(body),
  });
  fmtRows(Array.isArray(data) ? data : [data]);
  process.exit(0);
}

if (!table) {
  console.error('Uso: node scripts/debug/db.mjs <tabla> [flags]');
  console.error('     node scripts/debug/db.mjs --schema');
  process.exit(1);
}

const params = new URLSearchParams();
params.set('select', select);
if (limit) params.set('limit', limit);
if (order) params.set('order', order);
for (const f of filters) {
  // PostgREST format: column=op.value
  const v = f.op === 'in' ? `(${f.value})` : f.value;
  params.append(f.column, `${f.op}.${v}`);
}

const data = await http(`/${table}?${params.toString()}`, { headers: header() });
fmtRows(data);
