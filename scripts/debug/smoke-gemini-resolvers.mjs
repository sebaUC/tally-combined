// Smoke test directo contra el REST de Gemini (no necesita SDK).
import * as fs from 'node:fs';

const envRaw = fs.readFileSync('.env', 'utf8');
const foundKeys = [];
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) {
    foundKeys.push(m[1]);
    if (!process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
if (!key) {
  console.error('FAIL: no encontré GEMINI_API_KEY / GOOGLE_API_KEY en .env');
  console.error('Keys presentes en .env:', foundKeys.join(', '));
  process.exit(1);
}

async function testEmbedding() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text: 'UBER EATS CHILE' }] },
      output_dimensionality: 768,
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`FAIL embed    → status=${res.status} ${(await res.text()).slice(0, 240)}`);
    return;
  }
  const json = await res.json();
  const dims = json.embedding?.values?.length ?? 0;
  console.log(`OK embed      → gemini-embedding-001 dims=${dims} latency=${ms}ms  ${dims === 768 ? '✓' : '✗ (dim mismatch)'}`);
}

async function testGenerate() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Responde solo la palabra "pong" y nada más.' }] }],
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`FAIL generate → status=${res.status} ${(await res.text()).slice(0, 240)}`);
    return;
  }
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '(vacío)';
  console.log(`OK generate   → gemini-2.5-flash reply="${text}" latency=${ms}ms`);
}

await testEmbedding();
await testGenerate();
