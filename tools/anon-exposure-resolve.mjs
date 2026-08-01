// harden-resolve.mjs — turn "anon saw []" from AMBIGUOUS into a VERDICT.
//
// "Empty" only proves protection if the table actually CONTAINS something. So: count rows with the
// SERVICE key (God mode, sees everything), then compare against what ANON saw.
//   rows > 0 AND anon sees 0  -> RLS VERIFIED WORKING (real evidence)
//   rows = 0                  -> UNTESTED. Not safe, just empty. Re-run when customer data exists.
//
// This is the "empty != safe" rule made mechanical instead of a caveat nobody acts on.
// STRICTLY READ-ONLY.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const W = join('E:', 'und-industries-website');
const js = readFileSync(join(W, 'docs', 'assets', 'js', 'services.js'), 'utf8');
const URL_ = (js.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
const ANON = (js.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];

const env = {};
for (const l of readFileSync(join(W, '.dev.vars'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/); if (m) env[m[1]] = m[2];
}
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) { console.log('no service key available — cannot resolve ambiguity'); process.exit(0); }

const TABLES = ['announcements', 'chat_messages', 'contact_messages', 'entitlements', 'feedback',
  'profiles', 'purchases', 'service_reviews', 'service_tickets', 'store_categories',
  'store_tags', 'system_logs', 'tos_consents', 'webhook_events'];

const count = async (t, key) => {
  try {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range') || '';
    const n = cr.split('/')[1];
    return n === '*' ? null : parseInt(n, 10);
  } catch { return null; }
};

const out = [];
for (const t of TABLES) {
  const real = await count(t, SERVICE);
  const seen = await count(t, ANON);
  let verdict;
  if (real === null) verdict = 'COUNT FAILED';
  else if (real === 0) verdict = 'UNTESTED (table empty)';
  else if (seen === 0 || seen === null) verdict = 'RLS VERIFIED WORKING';
  else if (seen < real) verdict = `PARTIAL (anon sees ${seen}/${real})`;
  else verdict = '*** FULLY EXPOSED ***';
  out.push({ t, real, seen, verdict });
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\nTABLE                        rows(service)  anon sees   VERDICT');
console.log('-'.repeat(78));
for (const r of out.sort((a, b) => (b.real ?? -1) - (a.real ?? -1))) {
  console.log(`  ${pad(r.t, 26)} ${pad(r.real ?? '?', 13)} ${pad(r.seen ?? 0, 11)} ${r.verdict}`);
}

const proven  = out.filter((r) => r.verdict === 'RLS VERIFIED WORKING');
const untested = out.filter((r) => r.verdict.startsWith('UNTESTED'));
const bad     = out.filter((r) => r.verdict.includes('EXPOSED') || r.verdict.startsWith('PARTIAL'));

console.log('');
console.log(`  PROVEN protected : ${proven.length}   (${proven.map((r) => r.t).join(', ') || 'none'})`);
console.log(`  UNTESTED (empty) : ${untested.length}   <- NOT proof of safety. Re-run when data exists.`);
console.log(`  LEAKING          : ${bad.length}${bad.length ? '  *** ' + bad.map((r) => r.t).join(', ') + ' ***' : ''}`);
console.log('');
