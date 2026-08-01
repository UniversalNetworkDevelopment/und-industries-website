// anon-exposure-probe.mjs — can an anonymous visitor read any of your data?
//
// Probes EVERY table PostgREST exposes, using the PUBLIC ANON KEY that sits in the client JS and
// which every visitor already has. That is the real attacker's position. Reading pg_policies tells
// you what is CONFIGURED; attempting the read tells you what is TRUE. Only one of those matters.
//
// ── WHY THIS FILE WAS REWRITTEN ON 2026-08-01 ───────────────────────────────────────────────────
// The first version enumerated tables by REGEX-SCANNING THE SOURCE for `from('x')`, `CREATE TABLE x`
// and `/rest/v1/x`. It found 18 tables, probed them, found nothing leaking, and the website was
// reported clean.
//
// PostgREST actually exposes 57. The enumeration missed 39 of them — including `customers` (holds
// every customer's email address), `document_vault`, `client_secure_tokens`, `legal_signatures`,
// `audit_logs` and `ledger`. It missed `customers` for a dull reason: functions/util/supabase.js
// calls rest(env, 'customers?user_id=eq...'), and the `/rest/v1/` prefix is added inside the rest()
// helper — so the literal the regex was hunting for never appears in the source at all.
//
// The lesson is not "write a better regex". It is that a security probe must never enumerate its own
// scope by inference. ASK THE SERVER WHAT EXISTS. The OpenAPI document at GET /rest/v1/ is
// authoritative and cannot drift from reality, because it IS reality. A clean bill of health over an
// inferred subset is worse than no report at all: it is a false negative wearing a green tick.
//
// STRICTLY READ-ONLY: GET and HEAD only. Nothing is written, modified or deleted.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const W = join('E:', 'und-industries-website');

const env = {};
for (const l of readFileSync(join(W, '.dev.vars'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}
const URL_ = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// The anon key is deliberately taken from the SHIPPED CLIENT, not from .dev.vars — this must be the
// exact key a visitor holds, not whatever a local config happens to say.
const ANON = (readFileSync(join(W, 'docs', 'assets', 'js', 'services.js'), 'utf8')
  .match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];

if (!URL_ || !ANON) { console.log('could not resolve SUPABASE_URL / anon key'); process.exit(1); }

// Tables a leak from would hurt most. Used only to ORDER the report — every table is still probed.
const SENSITIVE = /customer|document|vault|secure|token|signature|audit|log|ledger|payment|financial|purchase|subscription|entitle|consent|profile|member|grant|ticket|message|deliverable|time_entr|work_/i;

const hdr = (k) => ({ apikey: k, Authorization: 'Bearer ' + k });

async function tableList() {
  const r = await fetch(URL_ + '/rest/v1/', { headers: hdr(SERVICE || ANON) });
  const spec = await r.json();
  return Object.keys(spec.definitions || spec.paths || {})
    .filter((k) => k && !k.startsWith('/') && k !== '(rpc)')
    .sort();
}

async function count(t, key) {
  try {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*`, {
      method: 'HEAD',
      headers: { ...hdr(key), Prefer: 'count=exact', Range: '0-0' },
    });
    const n = (r.headers.get('content-range') || '').split('/')[1];
    return n === '*' || n == null ? null : parseInt(n, 10);
  } catch { return null; }
}

const tables = await tableList();
console.log(`\nANON EXPOSURE PROBE — ${tables.length} tables, enumerated from the live PostgREST schema\n`);

const rows = [];
for (const t of tables) {
  let status = 0, body = '';
  try {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: hdr(ANON) });
    status = r.status;
    body = (await r.text()).slice(0, 100);
  } catch { status = -1; }

  const anonRows = status === 200 && body.trim() !== '[]' ? await count(t, ANON) : 0;
  const realRows = SERVICE ? await count(t, SERVICE) : null;

  let verdict;
  if (status !== 200) verdict = 'DENIED';
  else if (anonRows > 0) verdict = realRows != null && anonRows >= realRows ? 'FULLY EXPOSED' : 'EXPOSED';
  else if (realRows === null) verdict = 'EMPTY TO ANON (no service key to confirm)';
  else if (realRows === 0) verdict = 'UNTESTED (table empty)';
  else verdict = 'RLS VERIFIED WORKING';

  rows.push({ t, status, verdict, anonRows, realRows, body, sensitive: SENSITIVE.test(t) });
}

const exposed = rows.filter((r) => r.verdict.includes('EXPOSED'));
const proven = rows.filter((r) => r.verdict === 'RLS VERIFIED WORKING');
const untested = rows.filter((r) => r.verdict.startsWith('UNTESTED'));
const denied = rows.filter((r) => r.verdict === 'DENIED');

if (exposed.length) {
  console.log('*** ANONYMOUS CAN READ ACTUAL DATA ***');
  exposed.sort((a, b) => (b.sensitive ? 1 : 0) - (a.sensitive ? 1 : 0));
  for (const r of exposed) {
    console.log(`  ${r.sensitive ? '!! ' : '   '}${r.t.padEnd(28)} anon sees ${String(r.anonRows).padEnd(6)} of ${r.realRows}`);
    console.log(`       ${r.body.replace(/\s+/g, ' ').slice(0, 88)}`);
  }
  console.log('');
}

console.log(`RLS VERIFIED WORKING (${proven.length}) — table HAS rows, anon gets none. Real evidence.`);
console.log('  ' + (proven.map((r) => `${r.t}(${r.realRows})`).join(', ') || 'none'));

console.log(`\nDENIED outright (${denied.length}) — anon cannot even query.`);
console.log('  ' + (denied.map((r) => r.t).join(', ') || 'none'));

console.log(`\nUNTESTED (${untested.length}) — EMPTY, so returning nothing proves NOTHING. Re-run when data exists.`);
const sens = untested.filter((r) => r.sensitive);
console.log('  ' + (untested.map((r) => r.t).join(', ') || 'none'));
if (sens.length) console.log(`\n  ^ ${sens.length} of those are sensitive by name: ${sens.map((r) => r.t).join(', ')}`);

console.log(`\n  EXPOSED ${exposed.length}  ·  PROVEN ${proven.length}  ·  DENIED ${denied.length}  ·  UNTESTED ${untested.length}  ·  TOTAL ${rows.length}`);
console.log('');
process.exit(exposed.length ? 1 : 0);
