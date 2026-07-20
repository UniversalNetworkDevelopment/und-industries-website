#!/usr/bin/env node
// tools/check-prices.mjs — U.N.D price-list verifier
// ============================================================================
// WHY THIS EXISTS
//   A customer SEES the price in docs/assets/js/services.js (`cents`).
//   A customer is CHARGED the price in Supabase `store_products.price_cents`,
//   resolved server-side by slug at checkout (create-checkout-session.js).
//   Those two numbers MUST be identical. If they drift, someone sees $99 and
//   gets charged $129 — a silent, unaccountable surprise. That is exactly the
//   behavior U.N.D refuses to ship (see PAYMENTS-DECISION-remove-paypal.md).
//
//   This tool reads BOTH sides and reports every mismatch. It is the "verify"
//   in "document and verify everything."
//
// USAGE
//   node tools/check-prices.mjs
//
// SECURITY
//   Reads Supabase credentials from .dev.vars at RUNTIME and never prints them.
//   Prefers the service-role key (sees unpublished rows too); falls back to the
//   anon key (published rows only — still fine for a displayed-price check).
//
// EXIT CODE
//   0 = every displayed price matches its charged price (safe to sell).
//   1 = at least one drift/mismatch was found (do NOT sell until fixed).
//   2 = could not run (missing creds / unreadable files / network error).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usd = (c) => '$' + (Number(c) / 100).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);

// --- 1. Load Supabase creds from .dev.vars (values are NEVER printed) --------
function loadDevVars() {
  const p = path.join(ROOT, '.dev.vars');
  let raw = '';
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    console.error('ERROR: could not read ' + p);
    console.error('       Copy .dev.vars.example to .dev.vars and fill in the Supabase values.');
    process.exit(2);
  }
  const out = {};
  raw.split(/\r?\n/).forEach((line) => {
    if (/^\s*#/.test(line)) return; // skip comments
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
  return out;
}

// --- 2. Parse the website catalog from services.js --------------------------
function loadCatalog() {
  const p = path.join(ROOT, 'docs', 'assets', 'js', 'services.js');
  let src = '';
  try {
    src = fs.readFileSync(p, 'utf8');
  } catch {
    console.error('ERROR: could not read ' + p);
    process.exit(2);
  }
  const start = src.indexOf('var SERVICES');
  if (start === -1) {
    console.error('ERROR: could not find the SERVICES catalog in services.js');
    process.exit(2);
  }
  const block = src.slice(start, src.indexOf('};', start) + 1);
  const items = [];
  const re = /slug:\s*'([^']+)'[\s\S]*?cents:\s*(\d+)[\s\S]*?pay:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(block))) {
    items.push({ slug: m[1], cents: Number(m[2]), pay: m[3] });
  }
  return items;
}

const env = loadDevVars();
const SUPABASE_URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
const keyKind = env.SUPABASE_SERVICE_ROLE_KEY
  ? 'service_role (published + unpublished)'
  : 'anon (published only)';
if (!SUPABASE_URL || !KEY) {
  console.error('ERROR: .dev.vars is missing SUPABASE_URL or a Supabase key.');
  process.exit(2);
}

const catalog = loadCatalog();

// --- 3. Fetch the live Supabase price list ----------------------------------
const url =
  SUPABASE_URL +
  '/rest/v1/store_products?select=slug,title,price_cents,currency,type,is_published&order=slug';
let live;
try {
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!res.ok) {
    console.error('ERROR: Supabase read failed: ' + res.status + ' ' + (await res.text()));
    process.exit(2);
  }
  live = await res.json();
} catch (e) {
  console.error('ERROR: could not reach Supabase — ' + e.message);
  process.exit(2);
}
const bySlug = Object.fromEntries(live.map((r) => [r.slug, r]));

// --- 4. Compare and print ---------------------------------------------------
console.log('\nU.N.D PRICE VERIFICATION');
console.log('Supabase : ' + SUPABASE_URL);
console.log('Key      : ' + keyKind);
console.log('Catalog  : ' + catalog.length + ' items on services page, ' + live.length + ' rows in Supabase\n');
console.log(
  pad('SLUG', 24) + pad('SITE', 9) + pad('CHARGED', 9) + pad('STATE', 7) + pad('PUB', 5) + 'RESULT'
);
console.log('-'.repeat(78));

let problems = 0;
for (const item of catalog) {
  const row = bySlug[item.slug];
  const state = item.pay.indexOf('PLACEHOLDER_') === -1 ? 'live' : 'soon';
  let result;
  if (!row) {
    result = 'X MISSING in Supabase — charge would FAIL';
    problems++;
  } else if (row.price_cents !== item.cents) {
    result = 'X MISMATCH — site ' + usd(item.cents) + ' vs charge ' + usd(row.price_cents);
    problems++;
  } else if (state === 'live' && row.is_published === false) {
    result = 'X LIVE on site but UNPUBLISHED — charge would FAIL';
    problems++;
  } else {
    result = 'ok';
  }
  console.log(
    pad(item.slug, 24) +
      pad(usd(item.cents), 9) +
      pad(row ? usd(row.price_cents) : '--', 9) +
      pad(state, 7) +
      pad(row ? (row.is_published ? 'yes' : 'NO') : '--', 5) +
      result
  );
}

const extra = live.filter((r) => !catalog.find((c) => c.slug === r.slug));
if (extra.length) {
  console.log('\nIn Supabase but NOT on the services page (informational):');
  extra.forEach((r) =>
    console.log('  ' + pad(r.slug, 24) + usd(r.price_cents) + (r.is_published ? '' : '  (unpublished)'))
  );
}

console.log('');
if (problems) {
  console.log('RESULT: ' + problems + ' problem(s) found. Do NOT sell affected items until fixed.');
  process.exit(1);
} else {
  console.log('RESULT: all displayed prices match their charged prices. Safe.');
  process.exit(0);
}
