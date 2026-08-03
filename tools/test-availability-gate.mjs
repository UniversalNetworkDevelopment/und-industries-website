#!/usr/bin/env node
// test-availability-gate.mjs — can a product marked unavailable still be paid for?
//
// WHY THIS EXISTS
// On 2026-08-02, ELEVEN of the fifteen published, priced products were availability='soon' and
// every one of them could be bought — $149 to $3,500, including ai-integration at $3,500.
// services.html showed them as a disabled "Coming Soon"; /store sold them; and both payment
// endpoints were structurally blind to the column because getProductBySlug never selected it.
//
// The storefront button is only ever a suggestion. A stale cart, a back button or a hand-crafted
// POST all arrive at the endpoint, so the ENDPOINT is the only thing that actually decides whether
// money can be taken. That is what this tests, against the LIVE deployment.
//
// It follows the convention already set by E:\UND-Nexus\tests\qa.js: create a throwaway user, use
// it, delete it on the way out. No mess.
//
// It deliberately checks BOTH directions, because a gate that blocks everything is not a fix:
//   * a 'soon' product must be REFUSED with 409
//   * a 'live' product must get PAST the availability check (it may still fail further down for
//     unrelated reasons — anything that is not our 409 proves the gate let it through)
//
//   node tools/test-availability-gate.mjs
//
// Reads SUPABASE_SERVICE_ROLE_KEY from the environment, or falls back to .dev.vars for local runs.
// Never prints a credential.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SITE = process.env.SITE_URL || 'https://universalnetworkdevelopment.com';

const env = {};
try {
  for (const l of readFileSync('E:\\und-industries-website\\.dev.vars', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/); if (m) env[m[1]] = m[2];
  }
} catch { /* environment-only is fine */ }

const URL_ = process.env.SUPABASE_URL || env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = (readFileSync('E:\\und-industries-website\\docs\\assets\\js\\services.js', 'utf8')
  .match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];

if (!URL_ || !SERVICE || !ANON) { console.log('missing SUPABASE_URL / service key / anon key'); process.exit(2); }

const admin = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' };
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : '**FAIL**'}  ${name}${cond || !detail ? '' : `   (${detail})`}`);
};

// Pick real products straight from the catalogue rather than hardcoding slugs that can drift.
const products = await (await fetch(
  `${URL_}/rest/v1/store_products?select=slug,title,availability,price_cents&is_published=eq.true`,
  { headers: admin },
)).json();
const soon = products.find((p) => p.availability !== 'live' && p.price_cents > 0);
const live = products.find((p) => p.availability === 'live' && p.price_cents > 0);

console.log('\nAVAILABILITY GATE — against ' + SITE + '\n');
if (!soon) { console.log('  no non-live priced product to test with — nothing to prove'); process.exit(0); }
console.log(`  refusing-case : ${soon.slug}  (${soon.availability}, $${soon.price_cents / 100})`);
console.log(`  allowing-case : ${live ? live.slug + `  (live, $${live.price_cents / 100})` : '(none found)'}\n`);

// ── throwaway user ──────────────────────────────────────────────────────────
const email = `gate-test-${Date.now()}-${randomBytes(3).toString('hex')}@und-test.invalid`;
const password = randomBytes(18).toString('base64url');   // ephemeral, never printed, deleted below
let userId = null, token = null;

try {
  const created = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const cu = await created.json();
  userId = cu && cu.id;
  ok('throwaway user created', !!userId, JSON.stringify(cu).slice(0, 120));
  if (!userId) throw new Error('cannot continue without a user');

  const signed = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const sj = await signed.json();
  token = sj && sj.access_token;
  ok('signed in, got an access token', !!token, JSON.stringify(sj).slice(0, 120));
  if (!token) throw new Error('cannot continue without a session');

  const checkout = async (slug) => {
    const r = await fetch(`${SITE}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ items: [{ slug, quantity: 1 }] }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  };

  // ── THE TEST THAT MATTERS ────────────────────────────────────────────────
  const bad = await checkout(soon.slug);
  console.log('');
  ok(`'${soon.availability}' product is REFUSED`, bad.status === 409, `HTTP ${bad.status} ${bad.body}`);
  ok('  refusal names availability', /availab/i.test(bad.body), bad.body);
  ok('  no Stripe session handed back', !/checkout\.stripe\.com|"url"\s*:/.test(bad.body), bad.body);

  // ── AND THAT IT IS NOT A BLANKET BLOCK ───────────────────────────────────
  if (live) {
    const good = await checkout(live.slug);
    ok("'live' product gets PAST the availability gate", good.status !== 409,
      `HTTP ${good.status} ${good.body}`);
    console.log(`        (live-product response: HTTP ${good.status} — anything but 409 means our gate let it through)`);
  }
} catch (e) {
  fail++; console.log('  **FAIL**  ' + e.message);
} finally {
  // Always clean up, even on a thrown error. A test that leaves an account behind is a mess that
  // outlives the bug it was checking.
  if (userId) {
    const d = await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: admin });
    const gone = await fetch(`${URL_}/auth/v1/admin/users/${userId}`, { headers: admin });
    console.log('');
    ok('throwaway user deleted', d.ok && gone.status === 404, `delete ${d.status}, lookup ${gone.status}`);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
