// tools/test-flow-integration.mjs
// Executes the REAL Worker handlers against a mocked Supabase + Resend and asserts the
// whole order lifecycle. This is not a template render — it imports the actual
// onRequestPost/onRequestGet functions and drives them with real request shapes.
//
// WHY: every bug that nearly shipped today (slug-instead-of-name, missing import,
// invented product_usage_proof columns) passed `node --check` and would only have
// surfaced in front of a paying customer. Syntax checks prove nothing about behaviour.
//
//   node tools/test-flow-integration.mjs

let fails = 0;
const ok = (label, pass, detail) => {
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  -> ' + detail : ''));
  if (!pass) fails++;
};
const section = (t) => console.log('\n' + t);

// ── in-memory Supabase ──────────────────────────────────────────────────────
const DB = {
  service_tickets: [{
    id: '11111111-2222-3333-4444-555555555555',
    ticket_number: 'UND-2607-01031',
    service_name: 'Website Full Cleanup',
    service_slug: 'website-fix-cleanup',
    status: 'paid',
    intake_status: 'submitted',
    // THIS SEED IS THE REASON THE TEST NEVER CAUGHT THE BUG. It used to read
    //   intake_data: { site_url, platform, contact_email, contact_name }
    // — a column that does not exist, holding four keys that nothing has ever written. The
    // handlers were driven against this mock, so the suite asserted what the CODE did rather
    // than what the DATABASE holds, and passed green while every real delivery was dead.
    // A fixture is a claim about production. This one is now copied from the actual writer,
    // docs/assets/js/service-intake.js:357-390, and from the live column list.
    order_details: {
      target_url:          'https://brightpathdental.com',
      problem:             'checkout breaks on mobile',
      desired_outcome:     'working mobile checkout',
      notes:               null,
      access_method_label: 'WordPress admin invite',
      submitted_at:        '2026-07-19T10:05:00Z',
    },
    user_id: 'user-uuid-1234',
    created_at: '2026-07-19T10:00:00Z',
  }],
  // The customer's email address lives HERE, not on the ticket. create-checkout-session.js:61
  // writes this row before Stripe is ever reached, so it exists for every paying user. The old
  // fixture had no customers table at all, which is precisely why nothing noticed that the
  // completion email was reading an address out of a JSON blob that never contained one.
  customers: [{ user_id: 'user-uuid-1234', stripe_customer_id: 'cus_mock',
                email: 'sarah@brightpathdental.com' }],
  store_products: [{ slug: 'website-fix-cleanup', title: 'Website Full Cleanup',
                     price_cents: 34900, currency: 'usd', type: 'service', id: 'prod-1' }],
  product_usage_proof: [],
  service_reviews: [],
  purchases: [],
  event_log: [],
};
const SENT = [];

// Mock fetch: intercepts Supabase REST + Resend, passes nothing else through.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;

  if (u.includes('api.resend.com/emails')) {
    SENT.push({ ...body, idempotencyKey: init.headers && init.headers['Idempotency-Key'] });
    return { ok: true, status: 200, json: async () => ({ id: 'email-' + SENT.length }) };
  }

  if (u.includes('/rest/v1/')) {
    const table = u.split('/rest/v1/')[1].split('?')[0];
    if (method === 'GET') {
      let rows = DB[table] || [];
      const q = u.split('?')[1] || '';
      const eq = [...q.matchAll(/([a-z_]+)=eq\.([^&]+)/g)];
      for (const [, col, val] of eq) rows = rows.filter(r => String(r[col]) === decodeURIComponent(val));
      // `text` as well as `json`: util/supabase.js rest() reads res.text() and parses it, so a
      // mock that only implements json() throws TypeError on every helper that goes through
      // rest() — and the throw lands in a caller's catch and looks like "no data" rather than
      // "your fixture is wrong". A mock must match the REAL Response surface, not just the part
      // the first caller happened to use.
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
    }
    if (method === 'POST') {
      (DB[table] = DB[table] || []).push(body);
      return { ok: true, status: 201, text: async () => '', json: async () => [body] };
    }
    if (method === 'PATCH') {
      const q = u.split('?')[1] || '';
      const eq = [...q.matchAll(/([a-z_]+)=eq\.([^&]+)/g)];
      let rows = DB[table] || [];
      for (const [, col, val] of eq) rows = rows.filter(r => String(r[col]) === decodeURIComponent(val));
      rows.forEach(r => Object.assign(r, body));
      return { ok: true, status: 204, text: async () => '', json: async () => rows };
    }
  }
  if (u.includes('/auth/v1/user')) {
    const t = (init.headers && init.headers.Authorization) || '';
    if (t.includes('OWNER_TOKEN')) return { ok: true, json: async () => ({ id: 'owner-uuid', email: 'a@b.c' }) };
    if (t.includes('CUSTOMER_TOKEN')) return { ok: true, json: async () => ({ id: 'user-uuid-1234', email: 'c@d.e' }) };
    return { ok: false, status: 401, json: async () => ({}) };
  }
  return realFetch(url, init);
};

const ENV = {
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  RESEND_API_KEY: 're_mock',
  OWNER_EMAIL: 'contact.undindustries@gmail.com',
  MAIL_FROM: 'UND Industries <orders@universalnetworkdevelopment.com>',
  OWNER_USER_ID: 'owner-uuid',
  ALLOWED_ORIGIN: 'https://universalnetworkdevelopment.com',
  AGENT_SERVICE_KEY: 'agent-secret-key-32-chars-long!!',
};
const req = (url, opts = {}) => new Request(url, opts);

const adminJob = (await import('../functions/api/admin-job.js'));
const intakeNotify = (await import('../functions/api/intake-notify.js'));
const review = (await import('../functions/api/review.js'));

console.log('ORDER FLOW — INTEGRATION');

// ── INTAKE NOTIFY ───────────────────────────────────────────────────────────
section('1. Intake arrives -> owner is told work can start');
SENT.length = 0;
let r = await intakeNotify.onRequestPost({ env: ENV, request: req(
  'https://x.test/api/intake-notify', { method: 'POST', body: JSON.stringify({ ticket: 'UND-2607-01031' }) }) });
ok('endpoint returns ok', (await r.clone().json()).ok === true);
ok('owner emailed exactly once', SENT.length === 1, SENT.length + ' sent');
ok('subject says READY TO START', /READY TO START/.test(SENT[0]?.subject || ''), SENT[0]?.subject);
ok('email contains their site url', /brightpathdental\.com/.test(SENT[0]?.html || ''));
ok('email goes to the OWNER', (SENT[0]?.to || []).includes('contact.undindustries@gmail.com'));

section('2. Forged intake alert for a ticket NOT submitted -> refuses');
DB.service_tickets[0].intake_status = 'awaiting_intake';
SENT.length = 0;
r = await intakeNotify.onRequestPost({ env: ENV, request: req(
  'https://x.test/api/intake-notify', { method: 'POST', body: JSON.stringify({ ticket: 'UND-2607-01031' }) }) });
ok('refuses to cry wolf', SENT.length === 0, SENT.length + ' sent');
ok('bad ticket format rejected', (await (await intakeNotify.onRequestPost({ env: ENV, request: req(
  'https://x.test/api/intake-notify', { method: 'POST', body: JSON.stringify({ ticket: 'DROP TABLE' }) }) })).json()).ok === false);
DB.service_tickets[0].intake_status = 'submitted';

// ── ADMIN JOB ───────────────────────────────────────────────────────────────
section('3. Auth on the admin endpoint');
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'start' }) }) });
ok('no token -> 401', r.status === 401, 'got ' + r.status);
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: { Authorization: 'Bearer CUSTOMER_TOKEN' },
    body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'start' }) }) });
ok('customer token -> 403 (not owner)', r.status === 403, 'got ' + r.status);

section('4. Mark started');
const OWNER = { Authorization: 'Bearer OWNER_TOKEN', 'Content-Type': 'application/json' };
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: OWNER, body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'start' }) }) });
let j = await r.json();
ok('returns ok', j.ok === true, JSON.stringify(j).slice(0, 90));
ok('ticket is now in_progress', DB.service_tickets[0].intake_status === 'in_progress',
   DB.service_tickets[0].intake_status);
ok('started_at recorded', !!DB.service_tickets[0].order_details.started_at);

section('5. Deliver -> proof + review email');
SENT.length = 0;
// ACCEPTANCE GATE (2026-07-25): delivery now requires an explicit assertion that the work
// matches what was ordered, plus a non-empty description of the work. This is not the test
// being bent to fit the code - the CONTRACT changed deliberately, because previously anything
// holding a key could mark a job delivered and email the customer "your work is complete"
// with nothing comparing delivered against ordered. The stricter contract is asserted here,
// and section 5b proves the gate actually refuses the cases it exists to refuse.
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: OWNER, body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'deliver',
    workDone: ['Fixed the contact form', 'Repaired 3 broken links'],
    matches_order: true,
    deliverable: 'https://customer-site.test/ - contact form + links verified working' }) }) });
j = await r.json();
ok('returns ok', j.ok === true);
// CANONICAL terminal state is 'delivered' (supabase/fulfillment_chain.sql:12) — the same
// value the Qwep path writes (UND-Nexus/routes/orders.js, E:\Qwep\ticket-relay.js).
// This assertion previously demanded 'complete', so it was ENCODING the bug rather than
// catching it: that is how a wrong value survived a fully green suite. A test that asserts
// what the code does, instead of what the schema says, verifies nothing.
ok('ticket is delivered (canonical state)', DB.service_tickets[0].intake_status === 'delivered',
   DB.service_tickets[0].intake_status);
ok('status advanced past paid', DB.service_tickets[0].status === 'delivered',
   DB.service_tickets[0].status);
ok('completed_at stamped (Nexus cockpit counts on it)', !!DB.service_tickets[0].completed_at);
ok('delivered_at recorded', !!DB.service_tickets[0].order_details.delivered_at);
ok('reports customer_emailed truthfully', j.customer_emailed === true, String(j.customer_emailed));

const proof = DB.product_usage_proof[0];
ok('product_usage_proof row written', !!proof);
ok('  user_id set (NOT NULL column)', !!proof?.user_id, proof?.user_id);
ok('  service_rendered normalised', proof?.service_rendered === 'website_fix_cleanup', proof?.service_rendered);
ok('  resource_id is the ticket UUID', proof?.resource_id === DB.service_tickets[0].id);
ok('  execution_time_ms computed', typeof proof?.execution_time_ms === 'number', String(proof?.execution_time_ms));
ok('  log_of_thought carries the work', (proof?.log_of_thought?.work_done || []).length === 2);
ok('  NO invented columns', !('ticket_number' in (proof || {})) && !('kind' in (proof || {})) && !('detail' in (proof || {})));

ok('customer got the completion email', SENT.length === 1, SENT.length + ' sent');
ok('  subject says complete', /is complete/.test(SENT[0]?.subject || ''), SENT[0]?.subject);
ok('  sent to the CUSTOMER', (SENT[0]?.to || []).includes('sarah@brightpathdental.com'));
ok('  contains 5 star links', ((SENT[0]?.html || '').match(/rating=\d/g) || []).length === 5);
ok('  reply-to is the owner', SENT[0]?.reply_to === 'contact.undindustries@gmail.com');
ok('  idempotency key set', /^complete-UND-2607-01031$/.test(SENT[0]?.idempotencyKey || ''));

// ── AGENT AUTH ───────────────────────────────────────────────────────────────
// Delivery is now reachable by headless agents (Qwep/Nexus) via a shared key, so that all
// three delivery paths run the ONE implementation that emails the customer. An auth branch
// that is not tested is how a bypass ships. Every rejection case is asserted, including the
// unconfigured case — a missing secret must FAIL CLOSED, never degrade to "allow".
section('5b. Agent auth (Qwep/Nexus service key)');
const AGENT_HDR = { 'X-UND-Agent-Key': ENV.AGENT_SERVICE_KEY, 'Content-Type': 'application/json' };

// wrong key -> 403
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: { 'X-UND-Agent-Key': 'wrong-key-same-length-padding!!!', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'note', note: 'x' }) }) });
ok('wrong agent key -> 403', r.status === 403, 'got ' + r.status);

// right length but different content -> still 403 (constant-time compare must not pass)
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: { 'X-UND-Agent-Key': ENV.AGENT_SERVICE_KEY.slice(0, -1) + '?', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'note', note: 'x' }) }) });
ok('near-miss key -> 403', r.status === 403, 'got ' + r.status);

// key presented but server has none configured -> 503, NOT 200. Fail closed.
const ENV_NO_AGENT = { ...ENV }; delete ENV_NO_AGENT.AGENT_SERVICE_KEY;
r = await adminJob.onRequestPost({ env: ENV_NO_AGENT, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: AGENT_HDR, body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'note', note: 'x' }) }) });
ok('agent key with NO server key -> 503 (fails closed)', r.status === 503, 'got ' + r.status);

// no credentials at all -> 401
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'note', note: 'x' }) }) });
ok('no credentials -> 401', r.status === 401, 'got ' + r.status);

// valid agent key -> allowed, and the ticket is UNCHANGED by a note action
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: AGENT_HDR,
    body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'note', agent: 'qwep', note: 'qwep checked in' }) }) });
ok('valid agent key -> 200', r.status === 200, 'got ' + r.status);

// an agent cannot forge an arbitrary actor into the evidence trail
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: AGENT_HDR,
    body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'note', agent: 'Alex Ekwueme (owner)', note: 'y' }) }) });
ok('bogus agent name is not accepted verbatim', r.status === 200);
// (whitelist collapses anything unrecognised to 'agent'; asserted on a real delivery below)

section('5c. Acceptance gate must REFUSE what it exists to refuse');
// A gate is only real if it is proven to say NO. These use a fresh paid ticket so the
// already-delivered guard cannot be what refuses them.
DB.service_tickets.push({ id: 'gate1', ticket_number: 'UND-2607-05555', service_slug: 'website-fix-quick',
  status: 'paid', intake_status: 'in_progress',
  order_details: { desired_outcome: 'make the checkout work on mobile' }, user_id: 'u3' });

SENT.length = 0;
// (a) An AGENT must never be able to tell a customer their work is done.
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: AGENT_HDR, body: JSON.stringify({ ticket: 'UND-2607-05555', action: 'deliver',
    agent: 'qwep', workDone: ['did the thing'], matches_order: true }) }) });
ok('agent delivery refused (403)', r.status === 403, 'got ' + r.status);
j = await r.json().catch(() => ({}));
ok('  tells the caller it awaits the owner', j.awaiting_owner_approval === true);
ok('  ticket NOT marked delivered', DB.service_tickets.find(t => t.ticket_number === 'UND-2607-05555').intake_status !== 'delivered');
ok('  customer NOT emailed', SENT.length === 0);

// (b) A delivery with no description of the work is unverifiable.
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: OWNER, body: JSON.stringify({ ticket: 'UND-2607-05555', action: 'deliver',
    workDone: [], matches_order: true }) }) });
ok('empty workDone refused (400)', r.status === 400, 'got ' + r.status);

// (c) Nobody may deliver without asserting it matches the order.
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: OWNER, body: JSON.stringify({ ticket: 'UND-2607-05555', action: 'deliver',
    workDone: ['did the thing'] }) }) });
ok('missing matches_order refused (400)', r.status === 400, 'got ' + r.status);
j = await r.json().catch(() => ({}));
ok('  echoes what was ORDERED so it can be checked', j.ordered === 'make the checkout work on mobile');
ok('  still no customer email from any refusal', SENT.length === 0);

section('6. Double-deliver must NOT re-send');
SENT.length = 0;
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: OWNER, body: JSON.stringify({ ticket: 'UND-2607-01031', action: 'deliver' }) }) });
ok('refuses with 409', r.status === 409, 'got ' + r.status);
ok('no duplicate email', SENT.length === 0);

section('7. Deliver an UNPAID ticket must refuse');
DB.service_tickets.push({ id: 'aaa', ticket_number: 'UND-2607-09999', service_slug: 'website-fix-quick',
  status: 'checkout_started', intake_status: 'awaiting_intake', order_details: {}, user_id: 'u2' });
r = await adminJob.onRequestPost({ env: ENV, request: req('https://x.test/api/admin-job',
  { method: 'POST', headers: OWNER, body: JSON.stringify({ ticket: 'UND-2607-09999', action: 'deliver' }) }) });
ok('unpaid -> 409', r.status === 409, 'got ' + r.status);

// ── REVIEW ──────────────────────────────────────────────────────────────────
section('8. Star rating capture');
SENT.length = 0;
r = await review.onRequestGet({ env: ENV, request: req(
  'https://x.test/api/review?ticket=UND-2607-01031&rating=5') });
ok('redirects to the thanks page', r.status === 302);
ok('  carries status=ok', /status=ok/.test(r.headers.get('location') || ''), r.headers.get('location'));
ok('rating row written', DB.service_reviews.length === 1);
ok('  correct value', DB.service_reviews[0]?.rating === 5);
ok('owner alerted', SENT.length === 1);

section('9. Hostile / duplicate ratings');
r = await review.onRequestGet({ env: ENV, request: req('https://x.test/api/review?ticket=UND-2607-01031&rating=4') });
ok('second rating refused (one per ticket)', /status=already/.test(r.headers.get('location') || ''));
ok('  original value untouched', DB.service_reviews[0]?.rating === 5);
for (const [label, qs] of [['rating=9', 'ticket=UND-2607-01031&rating=9'],
                           ['rating=abc', 'ticket=UND-2607-01031&rating=abc'],
                           ['sql-ish ticket', "ticket=UND';DROP--&rating=5"],
                           ['no params', '']]) {
  const rr = await review.onRequestGet({ env: ENV, request: req('https://x.test/api/review?' + qs) });
  const loc = rr.headers.get('location') || '';
  ok('  rejects ' + label, /status=(badref|badrating)/.test(loc), loc.split('?')[1]);
}
ok('no junk rows created', DB.service_reviews.length === 1, DB.service_reviews.length + ' rows');

section('10. Low rating escalates');
DB.service_reviews.length = 0;
SENT.length = 0;
await review.onRequestGet({ env: ENV, request: req('https://x.test/api/review?ticket=UND-2607-09999&rating=2') });
ok('owner alerted on 2 stars', SENT.length === 1);
ok('  subject flags it LOW', /LOW RATING/.test(SENT[0]?.subject || ''), SENT[0]?.subject);
ok('  body says reach out today', /Reach out today/i.test(SENT[0]?.html || ''));

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'ALL PASS') + '\n');
process.exit(fails ? 1 : 0);
