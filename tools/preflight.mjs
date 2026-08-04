// tools/preflight.mjs — THE GATE. Run before every push. Wired to .git/hooks/pre-push.
//
//   node tools/preflight.mjs          # full check
//   node tools/preflight.mjs --quick  # skip the live-Supabase probes (offline)
//
// WHY THIS EXISTS
// On 2026-07-20 every unit + integration suite was green and pushing would still have taken
// the store offline. The client now reads availability from the database
// (store_products.availability), and that column DOES NOT EXIST in the live project. The
// query 400s, site-state.js catches it, the availability map is empty, availabilityOf()
// returns 'soon' for every slug, canPurchase() returns false, and EVERY BUY BUTTON GOES
// DARK. Which is precisely the failure that cost 32 days at $0 revenue after 2026-06-17.
//
// Mocked tests cannot catch this by construction: the mock always has the column. The only
// thing that catches it is asking the REAL database whether the shape the deployed code
// depends on actually exists. That is what this does.
//
// PRINCIPLE: a deploy gate must verify the code's DATA DEPENDENCIES, not just its logic.
// "The tests pass" and "this will work in production" are different claims.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const QUICK = process.argv.includes('--quick');

let failures = [], warnings = [];
const say = (s) => console.log(s);
const fail = (what, why, fix) => { failures.push({ what, why, fix }); console.log(`  FAIL  ${what}`); };
const warn = (what, why, fix) => { warnings.push({ what, why, fix }); console.log(`  WARN  ${what}`); };
const pass = (what, detail) => console.log(`  ok    ${what}${detail ? '  — ' + detail : ''}`);

// ── 1. test suites ───────────────────────────────────────────────────────────
say('\n1. Test suites');
const SUITES = [
  ['tools/test-flow-integration.mjs',  'order flow (mocked Supabase + Resend)'],
  ['tools/test-chain-integration.mjs', 'website <-> Nexus <-> Qwep seam'],
  ['tools/test-email-encoding.mjs',    'customer-facing text (mojibake gate)'],
  ['tools/test-access-consent.mjs',    'site-access authorisation record'],
  ['tools/check-prices.mjs',           'seen price == charged price'],
];
for (const [file, label] of SUITES) {
  if (!existsSync(ROOT + file)) { warn(`${label} — SUITE MISSING`, `${file} not found`, `restore ${file}`); continue; }
  try {
    execFileSync(process.execPath, [ROOT + file], { stdio: 'pipe', cwd: ROOT });
    pass(label);
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const firstFail = out.split('\n').find(l => /FAIL/.test(l)) || out.split('\n').slice(-3)[0] || '';
    fail(label, firstFail.trim(), `node ${file}`);
  }
}

// ── 2. live data dependencies ────────────────────────────────────────────────
// The client's anon key is public by design (it is shipped in the JS and gated by RLS), so
// reading it from our own source is not a secret leak — it is using the same credential the
// browser will use, which is the only way to test what the browser will actually see.
say('\n2. Live data dependencies (what the deployed code will actually query)');

if (QUICK) {
  say('  ..    skipped (--quick)');
} else {
  const siteState = readFileSync(ROOT + 'docs/assets/js/site-state.js', 'utf8');
  const SUPA = (siteState.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const ANON = (siteState.match(/(eyJ[A-Za-z0-9_.-]{40,})/) || [])[1];

  if (!SUPA || !ANON) {
    fail('could not read Supabase URL/anon key from site-state.js', 'preflight cannot verify anything',
         'check docs/assets/js/site-state.js');
  } else {
    const probe = async (query, label, onRows) => {
      try {
        const r = await fetch(`${SUPA}/rest/v1/${query}`, {
          headers: { apikey: ANON, Authorization: 'Bearer ' + ANON },
        });
        const body = await r.json().catch(() => null);
        if (!r.ok) {
          const msg = (body && body.message) || `HTTP ${r.status}`;
          return { ok: false, msg };
        }
        return { ok: true, rows: Array.isArray(body) ? body : [] };
      } catch (e) {
        return { ok: false, msg: e.message };
      }
    };

    // 2a. THE ONE THAT MATTERS: the availability query that drives every buy button.
    const avail = await probe('store_products?select=slug,availability,availability_note');
    if (!avail.ok) {
      fail('store_products.availability is queryable',
           avail.msg + ' — site-state.js catches this, the availability map stays EMPTY, ' +
           'availabilityOf() returns "soon" for every slug, and EVERY BUY BUTTON IS DISABLED',
           'Run db_schema/03_availability_and_site_status.sql in the Supabase SQL editor, ' +
           'then set the services you sell to live (see the next check).');
    } else {
      pass('store_products.availability exists', avail.rows.length + ' products');
      // Existing is not enough — SOMETHING must be sellable, or the store is open with
      // nothing to buy. The migration defaults every row to 'soon', so running it is only
      // half the job and the half people forget.
      // 'inquiry' IS OPEN FOR BUSINESS (2026-08-03). This asserted availability==='live' only,
      // so the moment every service moved to the inquiry lane it blocked the push claiming the
      // store was dead — while every service was in fact reachable through the quote modal.
      //
      // The gate was right to fire; its DEFINITION was stale. It exists to stop a deploy where a
      // visitor has no way to begin, and 'live' stopped being the only way to begin. A guard whose
      // model of the world is narrower than the world raises false alarms, and a false alarm on
      // every push is how a real one gets waved through with --no-verify.
      const live    = avail.rows.filter(p => p.availability === 'live');
      const inquiry = avail.rows.filter(p => p.availability === 'inquiry');
      const open    = live.length + inquiry.length;
      if (open === 0) {
        fail('at least one service is reachable (live or inquiry)',
             `all ${avail.rows.length} products are soon/paused/hidden — a visitor has no way to start`,
             "UPDATE public.store_products SET availability='live' WHERE slug IN ('website-fix-quick', ...);  " +
             "-- or 'inquiry' to take quote requests instead of payments");
      } else if (live.length === 0) {
        // Not a failure — a deliberate, reversible business state worth stating out loud, because
        // "no service can take money" should never be something you discover by accident.
        pass('services reachable by QUOTE (no instant checkout)',
             `${inquiry.length} on inquiry: ${inquiry.map(p => p.slug).join(', ')}`);
      } else {
        pass('sellable services', live.map(p => p.slug).join(', ') +
             (inquiry.length ? ` · plus ${inquiry.length} on inquiry` : ''));
      }
    }

    // 2b. site_status — the maintenance/splash switch.
    const status = await probe('site_status?select=mode,build_version&id=eq.1');
    if (!status.ok) {
      warn('site_status is queryable',
           status.msg + ' — the site still works (site-state.js fails OPEN, so no phantom ' +
           'outage), but maintenance mode CANNOT BE TURNED ON: the switch has no table.',
           'Run db_schema/03_availability_and_site_status.sql.');
    } else if (!status.rows.length) {
      warn('site_status has its row id=1', 'table exists but the singleton row is missing',
           'Re-run the INSERT at the bottom of 03_availability_and_site_status.sql.');
    } else {
      const mode = status.rows[0].mode;
      pass('site_status readable', 'mode=' + mode);
      // The reason this gate exists at all: a splash left up is a closed shop.
      if (mode === 'maintenance' || mode === 'closed') {
        fail(`site is currently mode='${mode}'`,
             'you are about to push while the store is CLOSED to customers — if this is the ' +
             'end of a maintenance window, turn it off as part of this deploy',
             "UPDATE public.site_status SET mode='open' WHERE id=1;");
      }
    }

    // 2c. reviews table — the completion email links to it.
    const rev = await probe('service_reviews?select=id&limit=1');
    if (!rev.ok) {
      warn('service_reviews is queryable',
           rev.msg + ' — the 1-5 star links in the completion email will fail to record',
           'Run db_schema/04_service_reviews.sql.');
    } else pass('service_reviews exists');
  }
}

// ── 2b. LIVE ENDPOINT CONFIG ─────────────────────────────────────────────────
// GAP IN THIS GATE, found 2026-07-20: section 2 verified live DATA dependencies but never
// asked whether the deployed WORKERS are configured. So `/api/admin-job` shipped returning
// 503 "Not configured — missing OWNER_USER_ID", which makes delivery impossible — no receipt,
// no review request, ever — and preflight passed anyway.
//
// A Cloudflare env var is invisible to every local test by construction. The only way to know
// is to ask production. A gate that only checks what it can see locally certifies the half of
// the system it never looked at.
say('\n2b. Live endpoint configuration (is the DEPLOYED code actually configured?)');
if (QUICK) {
  say('  ..    skipped (--quick)');
} else {
  const SITE = process.env.UND_SITE || 'https://universalnetworkdevelopment.com';
  const probes = [
    { path: '/api/admin-job',      method: 'POST', body: '{}',
      bad: 503, label: 'delivery endpoint',
      why: 'DELIVERY IS IMPOSSIBLE — no customer can receive a receipt or review request' },
    { path: '/api/create-checkout-session', method: 'POST', body: '{}',
      bad: 503, label: 'checkout endpoint', why: 'nobody can pay' },
    { path: '/api/stripe-webhook', method: 'POST', body: '{}',
      bad: 404, label: 'stripe webhook', why: 'every post-payment step is dead code' },
  ];
  for (const p of probes) {
    try {
      const r = await fetch(SITE + p.path, {
        method: p.method, headers: { 'Content-Type': 'application/json' }, body: p.body,
      });
      let detail = '';
      try { const j = await r.json(); detail = j && j.error ? j.error : ''; } catch (_) {}
      if (r.status === p.bad) {
        fail(`${p.label} is ${r.status}`, `${detail || 'not configured'} — ${p.why}`,
             'Set the missing variable in Cloudflare Pages -> Settings -> Environment variables, then redeploy.');
      } else {
        // 400/401 are HEALTHY here: the worker ran and rejected our deliberately invalid
        // request. That is the endpoint proving it is alive and validating.
        pass(`${p.label} configured`, `HTTP ${r.status}`);
      }
    } catch (e) {
      warn(`${p.label} unreachable`, e.message, 'check the site is deployed');
    }
  }
}

// ── 3. unpushed work ─────────────────────────────────────────────────────────
// "if you make an update for the website and dont push you fucked up" — Alex, 2026-07-20.
say('\n3. Working tree');
try {
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) {
    warn('uncommitted changes', dirty.split('\n').length + ' file(s) not committed — they will NOT deploy',
         'git add -A && git commit');
  } else pass('working tree clean');
} catch { warn('git status unavailable', 'not a git repo?', ''); }

// ── verdict ──────────────────────────────────────────────────────────────────
say('\n' + '='.repeat(70));
if (failures.length) {
  say(`PREFLIGHT FAILED — ${failures.length} blocker(s). DO NOT PUSH.\n`);
  failures.forEach((f, i) => {
    say(`${i + 1}. ${f.what}`);
    say(`   why: ${f.why}`);
    say(`   fix: ${f.fix}\n`);
  });
}
if (warnings.length) {
  say(`${warnings.length} warning(s):\n`);
  warnings.forEach((w, i) => {
    say(`${i + 1}. ${w.what}`);
    say(`   ${w.why}`);
    if (w.fix) say(`   fix: ${w.fix}`);
    say('');
  });
}
if (!failures.length) say('PREFLIGHT PASSED — safe to push.\n');
process.exit(failures.length ? 1 : 0);
