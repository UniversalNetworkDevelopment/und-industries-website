// tools/test-chain-integration.mjs
// CROSS-SYSTEM SEAM TEST — website + UND-Nexus + Qwep.
//
// WHY THIS EXISTS:
// Every system had its own green test suite while the chain between them was broken in four
// places. Per-repo tests structurally cannot catch this: each one mocks the neighbour it is
// supposed to agree with, so both sides can be confidently wrong in opposite directions.
// What actually broke was never inside a system — it was the SEAM:
//
//   1. VOCABULARY   — the website wrote intake_status='complete', a value the schema does
//                     not define. Qwep/Nexus wrote 'delivered'. A Qwep-fulfilled order fell
//                     outside the customer dashboard's filter and VANISHED from their view.
//   2. DEAD CONSUMER— Nexus's /next-pending implemented careful claim-on-read and is called
//                     by nobody; Qwep claims straight from Supabase.
//   3. NO ACTOR     — Qwep claimed paid orders, then prepareJob() only console.log'd.
//   4. NO NOTIFY    — three delivery paths existed; only one emailed the customer.
//
// So this asserts AGREEMENT BETWEEN REPOS, read from the real source files on disk. It is
// static analysis by necessity (the three systems cannot all be booted in one process), but
// every fact is extracted from real code — never restated from memory here, so drift in any
// repo fails the test instead of quietly invalidating it.
//
// Run: node tools/test-chain-integration.mjs

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Roots are overridable so this suite can be mutation-checked: point one at a deliberately
// broken copy and confirm the seam assertions actually go RED. A green seam test that cannot
// fail is the same lie as a health check that never looks.
const WEB   = process.env.CHAIN_WEB   || 'E:/und-industries-website/';
const NEXUS = process.env.CHAIN_NEXUS || 'E:/UND-Nexus/';
const QWEP  = process.env.CHAIN_QWEP  || 'E:/Qwep/';

let pass = 0, fail = 0, skip = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
};
const section = (t) => console.log('\n' + t);

// Reading is itself a verification step: a missing file must SKIP loudly, never silently
// pass. A seam test that quietly stops checking when a repo moves is worse than no test.
function read(path, label) {
  if (!existsSync(path)) { skip++; console.log('  SKIP  ' + label + ' NOT FOUND -> ' + path); return null; }
  return readFileSync(path, 'utf8');
}

// Strip comments before any ABSENCE assertion. These files document the bugs they fixed, so
// the old wrong value appears in prose right next to the corrected code — matching raw text
// then reports a defect that does not exist. (Caught immediately: the dashboard check failed
// against its own explanatory comment.) Presence assertions keep the full text; only
// "this must NOT appear" needs code-only input.
function codeOnly(src) {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const schema      = read(WEB + 'supabase/fulfillment_chain.sql', 'canonical schema');
const adminJob    = read(WEB + 'functions/api/admin-job.js', 'website admin-job');
const intakeJs    = read(WEB + 'docs/assets/js/service-intake.js', 'customer intake/dashboard');
const dashJs      = read(WEB + 'docs/assets/js/dashboard.js', 'customer dashboard');
const nexusOrders = read(NEXUS + 'routes/orders.js', 'Nexus orders route');
const nexusConfig = read(NEXUS + 'lib/config.js', 'Nexus config');
const qwepRelay   = read(QWEP + 'ticket-relay.js', 'Qwep ticket relay');

if (!schema || !adminJob || !nexusOrders || !qwepRelay) {
  console.log('\nCannot run the seam test without all three systems present.');
  process.exit(1);
}

// ── 1. CANONICAL VOCABULARY ──────────────────────────────────────────────────
section('1. All three systems speak the schema\'s vocabulary');

// Parsed from the schema comment that DEFINES the column, not typed in here.
const vocabLine = schema.match(/intake_status[^\n]*\n\s*--\s*([a-z_ |]+)/);
const CANON = vocabLine
  ? vocabLine[1].split('|').map(s => s.trim()).filter(Boolean)
  : [];
ok('parsed canonical states from fulfillment_chain.sql', CANON.length >= 4, CANON.join(' | '));

const TERMINAL = 'delivered';
ok('canonical terminal state is "delivered"', CANON.includes(TERMINAL));
ok('"complete" is NOT a canonical state', !CANON.includes('complete'),
   'the value the website used to write');

// Every intake_status a system WRITES must be in the canonical set.
const writes = (src, label) => {
  const found = new Set();
  for (const m of src.matchAll(/intake_status:\s*'([a-z_]+)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/intake_status:\s*intakeStatus/g)) { /* computed, checked below */ }
  return { label, values: [...found] };
};
for (const src of [
  writes(adminJob, 'website /api/admin-job'),
  writes(qwepRelay, 'Qwep ticket-relay'),
  writes(nexusOrders, 'Nexus orders'),
]) {
  const bad = src.values.filter(v => !CANON.includes(v));
  ok(`${src.label} writes only canonical states`, bad.length === 0,
     bad.length ? 'NON-CANONICAL: ' + bad.join(', ') : src.values.join(', ') || '(computed)');
}

// Nexus computes its terminal value; assert the computed branch resolves to 'delivered'.
ok('Nexus maps completed/delivered -> "delivered"',
   /isDelivery \? 'delivered'/.test(nexusOrders) ||
   /\(status === 'completed' \|\| status === 'delivered'\) \? 'delivered'/.test(nexusOrders));

// ── 2. WHAT IS WRITTEN IS WHAT IS READ ───────────────────────────────────────
section('2. Every terminal state written is visible to the customer');

if (intakeJs) {
  const filter = intakeJs.match(/\.in\('intake_status',\s*\[([^\]]+)\]/);
  const shown = filter ? filter[1].split(',').map(s => s.trim().replace(/'/g, '')) : [];
  ok('found the customer ticket filter', shown.length > 0, shown.join(', '));
  // THE bug: Qwep wrote 'delivered', the filter listed only submitted/in_progress/complete,
  // so a fulfilled order disappeared from the customer's own dashboard.
  ok('customer dashboard shows "delivered" tickets', shown.includes(TERMINAL),
     'a delivered order must not vanish from the buyer\'s view');
  ok('back-compat: old "complete" tickets still visible', shown.includes('complete'),
     'tickets closed by the old code must not disappear either');
}

if (dashJs) {
  const dashCode = codeOnly(dashJs);
  ok('dashboard success badge keys on a REAL status value',
     /status === 'delivered'/.test(dashCode) && !/status === 'complete'/.test(dashCode),
     "'complete' never occurs, so the badge could never turn green");
}

// Nexus's cockpit "completed" counter must count what the website actually writes.
const nexusCount = nexusOrders.match(/intake_status=eq\.([a-z_]+)&select=id/);
ok('Nexus completed-counter reads the same terminal state',
   !!nexusCount && nexusCount[1] === TERMINAL,
   nexusCount ? nexusCount[1] : 'not found');

// ── 3. ONE DELIVERY IMPLEMENTATION ───────────────────────────────────────────
section('3. Delivery is implemented once, and it notifies the customer');

ok('website admin-job sends the completion email',
   /serviceCompleteEmail/.test(adminJob) && /sendEmail/.test(adminJob));
ok('  and reports whether it ACTUALLY sent', /customer_emailed/.test(adminJob),
   'a 200 is not proof the customer heard from us');

// Same weakness as prepareJob, found the same way: asserting the FILE contains the endpoint
// passes even when the delivery handler no longer calls it — the helper definition alone
// satisfies the match. Assert the call site inside the handler that performs delivery.
const qwepComplete = (() => {
  const s = qwepRelay.indexOf('async function completeJob');
  if (s === -1) return '';
  const e = qwepRelay.indexOf('\nfunction clearPendingJob', s);
  return qwepRelay.slice(s, e > -1 ? e : qwepRelay.length);
})();
ok('located Qwep completeJob()', qwepComplete.length > 100, qwepComplete.length + ' chars');
ok('Qwep completeJob CALLS the website endpoint',
   /fetch\(`\$\{SITE_URL\}\/api\/admin-job`/.test(qwepComplete) &&
   /'X-UND-Agent-Key'/.test(qwepComplete));

const nexusPatch = (() => {
  const s = nexusOrders.indexOf("router.patch('/:orderId'");
  return s === -1 ? '' : nexusOrders.slice(s);
})();
ok('located Nexus PATCH handler', nexusPatch.length > 100, nexusPatch.length + ' chars');
ok('Nexus PATCH CALLS deliverViaSite on delivery',
   /await deliverViaSite\(/.test(codeOnly(nexusPatch)),
   'not merely that the helper exists somewhere in the file');
ok('Nexus deliverViaSite targets the website endpoint',
   /\/api\/admin-job/.test(nexusOrders) && /'X-UND-Agent-Key'/.test(nexusOrders));

// A silent fallback is how a "working" system stops notifying anyone. Both agents keep a
// direct-write fallback so a finished job is never lost — but it must be LOUD.
ok('Qwep fallback warns the customer was not emailed',
   /CUSTOMER WAS NOT EMAILED/.test(qwepRelay));
ok('Nexus fallback warns the customer was not emailed',
   /CUSTOMER WILL NOT BE EMAILED/.test(nexusOrders));

// ── 4. THE AGENT AUTH CONTRACT MATCHES ON BOTH ENDS ──────────────────────────
section('4. Agent auth: senders and receiver agree');

const HDR = 'x-und-agent-key';
ok('receiver reads the header', new RegExp(`get\\('${HDR}'\\)`, 'i').test(adminJob));
ok('Qwep sends the same header name', new RegExp(HDR, 'i').test(qwepRelay));
ok('Nexus sends the same header name', new RegExp(HDR, 'i').test(nexusOrders));

ok('senders use action:"deliver"',
   /action:\s*'deliver'/.test(qwepRelay) && /action: 'deliver'/.test(nexusOrders));
ok('receiver accepts a named agent', /body\.agent/.test(adminJob));
ok('  and WHITELISTS it (no forged actor in the evidence trail)',
   /AGENTS\s*=\s*\[/.test(adminJob) && /indexOf\(String\(body\.agent/.test(adminJob));

ok('receiver compares the key in constant time', /timingSafeEqual/.test(adminJob),
   'a plain === leaks the secret through response timing');
ok('receiver FAILS CLOSED when unconfigured',
   /if \(!env\.AGENT_SERVICE_KEY\)[\s\S]{0,120}503/.test(adminJob),
   'a missing secret must never degrade to allow');

// A hardcoded fallback secret would make the whole gate decorative.
ok('Qwep has NO hardcoded agent key',
   !/AGENT_SERVICE_KEY\s*=\s*[^;]*\|\|\s*['"][A-Za-z0-9_\-]{8,}['"]/.test(codeOnly(qwepRelay)));
if (nexusConfig) {
  ok('Nexus has NO hardcoded agent key',
     !/AGENT_SERVICE_KEY\s*=\s*[^;]*\|\|\s*['"][A-Za-z0-9_\-]{8,}['"]/.test(codeOnly(nexusConfig)));
  ok('Nexus exports SITE_URL + AGENT_SERVICE_KEY from config',
     /SITE_URL,\s*AGENT_SERVICE_KEY/.test(nexusConfig),
     'HOW-TO-WORK: import from config, never copy-paste into a route');
}

// ── 5. NO DOUBLE-CLAIM ───────────────────────────────────────────────────────
section('5. Two claimers cannot hand out the same paid order');

ok('Qwep claims only UNASSIGNED tickets',
   /assigned_agent=is\.null/.test(qwepRelay));
ok('Nexus next-pending also requires UNASSIGNED',
   /next-pending[\s\S]{0,900}assigned_agent=is\.null/.test(nexusOrders),
   'both filter on unassigned, so a claimed ticket is never served twice');

// ── 6. A CLAIM MUST HAVE AN ACTOR ────────────────────────────────────────────
section('6. A claimed order reaches a human');

// Scoped to prepareJob's ACTUAL body. A file-wide /sendMail\(/ passes as long as the
// failure-alarm path still calls it — so removing the claim notification, the exact
// regression this guards, went undetected in the first mutation run. Assert on the function
// that must do the work, not on the file that happens to contain a similar call.
const prepareBody = (() => {
  const start = qwepRelay.indexOf('async function prepareJob');
  if (start === -1) return '';
  const next = qwepRelay.indexOf('\nfunction ', start + 10);
  const next2 = qwepRelay.indexOf('\nasync function ', start + 10);
  const end = Math.min(...[next, next2].filter(i => i > -1).concat([qwepRelay.length]));
  return qwepRelay.slice(start, end);
})();
ok('located prepareJob()', prepareBody.length > 100, prepareBody.length + ' chars');
ok('Qwep EMAILS the owner from inside prepareJob',
   /await sendMail\(/.test(prepareBody) && /PAID JOB/.test(codeOnly(prepareBody)),
   'claiming without telling anyone is worse than not claiming');
ok('  and records the job durably even if email fails',
   /recordPendingJob\(/.test(prepareBody) && /jobs-pending\.json/.test(qwepRelay));
ok('  and alerts when the owner could NOT be emailed',
   /if \(!sent\.ok\)/.test(prepareBody));
ok('  and does NOT act on the customer system autonomously',
   /will NOT act on/i.test(qwepRelay), 'assist mode is deliberate');

// ── 7. FAILURE IS VISIBLE ────────────────────────────────────────────────────
section('7. Health signals can go red');

ok('Qwep counts consecutive failures', /consecutiveFailures/.test(qwepRelay));
ok('  escalates after a threshold', /ALARM_AFTER/.test(qwepRelay));
ok('  alarms exactly once, re-arming on recovery',
   /alarmSent = true/.test(qwepRelay) && /alarmSent = false/.test(qwepRelay));
ok('  writes a readable health file', /driver-health\.json/.test(qwepRelay),
   '"is it working" must be answerable without inferring from log silence');
ok('  timestamps every line', /new Date\(\)\.toISOString\(\)\}\] \[/.test(qwepRelay));
ok('claim() no longer swallows its own error',
   !/catch \(e\) \{ console\.error\('\[QWEP DRIVER\] claim error/.test(codeOnly(qwepRelay)),
   'a swallowed claim error never reached the failure counter');

// ── 8. THE FILES ACTUALLY PARSE ──────────────────────────────────────────────
// A text-only seam test will happily "pass" a file that no longer compiles — every regex
// still matches the broken source. Proven during mutation testing: an edit that produced
// `const viaSite = null; && deliverViaSite(...)` was invalid JavaScript and the suite went
// green. Parse the CommonJS agents for real.
section('8. Agent sources parse');
for (const [file, label] of [
  [QWEP + 'ticket-relay.js',  'Qwep ticket-relay'],
  [NEXUS + 'routes/orders.js', 'Nexus orders route'],
  [NEXUS + 'lib/config.js',    'Nexus config'],
]) {
  if (!existsSync(file)) { skip++; console.log('  SKIP  ' + label + ' not found'); continue; }
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    ok(`${label} parses`, true);
  } catch (e) {
    ok(`${label} parses`, false, String(e.stderr || e.message).split('\n')[0]);
  }
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') +
            `  (${pass} passed${skip ? ', ' + skip + ' skipped' : ''})`);
process.exit(fail === 0 ? 0 : 1);
