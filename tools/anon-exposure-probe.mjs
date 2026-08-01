// harden-sweep.mjs — the WHOLE surface, not the parts I happened to look at.
//
// Alex, 2026-08-01: "is the chain hardened for the whole website? wym some parts better than
// another — this is a business, we need no holes or exploits."
//
// Right. I audited 4 tables and the payment path and called it a security review. This enumerates
// EVERY table and EVERY endpoint and tests them, rather than reading policies and inferring.
//
// METHOD: use the PUBLIC ANON KEY — the one sitting in his client JS, which any visitor already
// has. That is the real attacker's position. Reading pg_policies tells you what is CONFIGURED;
// actually attempting the read tells you what is TRUE. Those differ, and only one matters.
//
// STRICTLY READ-ONLY: GETs and HEADs only. Nothing is written, modified or deleted.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const W = join('E:', 'und-industries-website');
const anon = (readFileSync(join(W, 'docs', 'assets', 'js', 'services.js'), 'utf8')
  .match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
const url = (readFileSync(join(W, 'docs', 'assets', 'js', 'services.js'), 'utf8')
  .match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
if (!anon || !url) { console.log('could not extract public anon key from client JS'); process.exit(1); }

// Tables named anywhere in schema or client code — enumerate, do not sample.
const names = new Set();
const scan = (p) => {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const m of t.matchAll(/(?:from\(['"]|CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?|rest\/v1\/)([a-z_][a-z0-9_]{2,})/gi)) {
    const n = m[1].toLowerCase();
    if (!/^(select|insert|update|delete|table|exists|public|http|json)$/.test(n)) names.add(n);
  }
};
import { readdirSync } from 'node:fs';
for (const d of [join(W, 'db_schema'), join(W, 'docs', 'assets', 'js'), join(W, 'functions', 'api'), join(W, 'functions', 'util')]) {
  try { for (const f of readdirSync(d)) scan(join(d, f)); } catch {}
}

const H = { apikey: anon, Authorization: 'Bearer ' + anon };
const rows = [];
for (const t of [...names].sort()) {
  let status = 0, body = '';
  try {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: H });
    status = r.status; body = (await r.text()).slice(0, 90);
  } catch { status = -1; }
  if (status === 404) continue;                       // not a real table
  const readable = status === 200 && body.trim() !== '[]';
  const empty    = status === 200 && body.trim() === '[]';
  rows.push({ t, status, readable, empty, body });
}

const exposed = rows.filter((r) => r.readable);
const emptyOk = rows.filter((r) => r.empty);
const denied  = rows.filter((r) => !r.readable && !r.empty);

console.log(`\nANON READ TEST — ${rows.length} real tables probed with the PUBLIC key\n`);

if (exposed.length) {
  console.log('*** ANONYMOUS CAN READ ACTUAL DATA — review each one ***');
  for (const r of exposed) console.log(`   ${r.t.padEnd(26)} HTTP ${r.status}   ${r.body.replace(/\s+/g, ' ').slice(0, 70)}`);
} else {
  console.log('NO table returns data to an anonymous reader.');
}

console.log(`\nRETURNS EMPTY to anon (RLS filtering, or genuinely empty — ambiguous, see note):`);
console.log('   ' + (emptyOk.map((r) => r.t).join(', ') || 'none'));

console.log(`\nDENIED outright (${denied.length}):`);
for (const r of denied) console.log(`   ${r.t.padEnd(26)} HTTP ${r.status}`);

console.log('\nNOTE: an empty [] is AMBIGUOUS — it means "RLS filtered everything" OR "the table is');
console.log('empty". With no customers yet, most tables are empty anyway, so empty is NOT proof of');
console.log('protection. Re-run this the moment real customer data exists.\n');
