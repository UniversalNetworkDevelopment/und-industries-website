// tools/test-order-email-e2e.mjs
// Simulates a REAL Stripe checkout.session.completed payload and asserts what the
// customer would actually receive: right address, right label, right content.
//
// Written 2026-07-19 after tracing found a bug that would have shipped:
// create-checkout-session.js writes metadata as { i, s, t, q } with NO name field, so the
// email fell back to the SLUG. A paying customer would have received
// "Order confirmed - one step to start your website-fix-cleanup".
// Asserting on rendered output is the only thing that catches that class of bug.
//
//   node tools/test-order-email-e2e.mjs

import { customerConfirmEmail, ownerSaleEmail } from '../functions/util/email.js';

let fail = 0;
const ok = (label, pass, detail) => {
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  -> ' + detail : ''));
  if (!pass) fail++;
};

// ── the exact shape Stripe sends ────────────────────────────────────────────
const stripeSession = {
  id: 'cs_live_a1B2c3D4e5F6g7H8',
  amount_total: 34900,
  currency: 'usd',
  payment_status: 'paid',
  client_reference_id: 'user-uuid-1234',
  customer_details: { email: 'sarah.mitchell@brightpathdental.com', name: 'Sarah Mitchell' },
  metadata: {
    supabase_user_id: 'user-uuid-1234',
    kind: 'one_time',
    ticket_number: 'UND-2607-01031',
    // NOTE: no name field — this is the real shape from create-checkout-session.js:133
    items: JSON.stringify([{ i: 'prod-1', s: 'website-fix-cleanup', t: 'service', q: 1 }]),
  },
};

// Mirror the webhook's own resolution logic, including the de-slug fallback used when
// the Supabase lookup is unavailable (which is the case in this offline test).
const raw = JSON.parse(stripeSession.metadata.items);
const named = raw.map((i) => ({
  name: String(i.s || 'Service').split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' '),
  slug: i.s,
  qty: i.q || 1,
}));

const order = {
  amount: stripeSession.amount_total,
  email: stripeSession.customer_details.email,
  ticket: stripeSession.metadata.ticket_number,
  sessionId: stripeSession.id,
  summary: named.length > 1 ? named.length + ' items' : named[0].name,
  items: named,
};

console.log('ORDER EMAIL — END TO END\n');

// ── 1. ADDRESSING: does it reach the real human? ────────────────────────────
ok('customer address extracted from Stripe payload',
  order.email === 'sarah.mitchell@brightpathdental.com', order.email);
ok('address is not null/placeholder',
  !!order.email && !/example\.com|test@/.test(order.email));

// ── 2. LABELLING: no raw slugs anywhere a human reads ───────────────────────
const c = customerConfirmEmail(order, 'https://universalnetworkdevelopment.com');
const o = ownerSaleEmail(order);

ok('subject shows a HUMAN name, not a slug',
  !/website-fix-cleanup/.test(c.subject), c.subject);
ok('customer body has no raw slug',
  !/website-fix-cleanup/.test(c.html));
ok('owner subject shows a human name',
  !/website-fix-cleanup/.test(o.subject), o.subject);
ok('de-slug produced proper Title Case',
  named[0].name === 'Website Fix Cleanup', named[0].name);

// ── 3. CONTENT: is the money and the reference right? ───────────────────────
ok('customer sees the correct total', /\$349\.00/.test(c.html));
ok('owner sees the correct total', /\$349\.00/.test(o.html));
ok('ticket reference present for the customer', /UND-2607-01031/.test(c.html));
ok('intake link carries the ticket',
  /service-intake\.html\?ticket=UND-2607-01031/.test(c.html));
ok('owner can see the customer address', /brightpathdental\.com/.test(o.html));

// ── 4. RENDERING: safe in real mail clients ─────────────────────────────────
ok('charset declared', /<meta charset="utf-8">/.test(c.html));
ok('colour-scheme locked (no dark-mode inversion)', /color-scheme/.test(c.html));
ok('no mojibake in customer email', !/â€/.test(c.html));
ok('no mojibake in owner email', !/â€/.test(o.html));
ok('plain-text alternative exists', !!c.text && c.text.length > 100);
ok('plain-text carries the intake link', /service-intake/.test(c.text));

// ── 5. MULTI-ITEM ORDER ─────────────────────────────────────────────────────
const multi = {
  ...order, amount: 29800,
  items: [
    { name: 'Website Quick Fix', slug: 'website-fix-quick', qty: 1 },
    { name: 'Website Fix Bundle', slug: 'website-fix-bundle', qty: 1 },
  ],
  summary: '2 items',
};
const cm = customerConfirmEmail(multi, 'https://universalnetworkdevelopment.com');
ok('multi-item: both names listed',
  /Website Quick Fix/.test(cm.html) && /Website Fix Bundle/.test(cm.html));
ok('multi-item: correct total', /\$298\.00/.test(cm.html));

// ── 6. MISSING DATA MUST NOT PRODUCE GARBAGE ────────────────────────────────
const bare = { amount: 9900, email: null, ticket: null, sessionId: 'cs_x', summary: 'Service', items: [] };
const cb = customerConfirmEmail(bare, 'https://universalnetworkdevelopment.com');
ok('no ticket -> falls back to the dashboard, no broken link',
  /dashboard\.html/.test(cb.html) && !/ticket=null|ticket=undefined/.test(cb.html));
ok('no items -> no empty/undefined rows',
  !/undefined|\[object/.test(cb.html));

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'ALL PASS') + '\n');
process.exit(fail ? 1 : 0);
