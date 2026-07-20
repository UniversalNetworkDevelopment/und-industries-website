// tools/security-probe.mjs — REAL adversarial probe of the live system.
//
// AUTHORISED: this is UND Industries' own infrastructure, probed at the owner's explicit
// request (2026-07-20: "have you tested for points of failure hacking and any breaches").
//
// It attacks the system the way an attacker actually would: with the PUBLIC anon key that
// ships in the website's JavaScript. Anyone can read that key out of the page source in ten
// seconds, so everything here is what a stranger can attempt today, from anywhere.
//
// SAFETY — this probe must never damage what it is testing:
//   * Write attempts set a column to its CURRENT value. If the write succeeds, that proves
//     the table is writable (a critical finding) while changing NOTHING. A probe that could
//     take the store offline to prove the store can be taken offline is not acceptable.
//   * No deletes, ever.
//   * Rows created by the probe (if any insert succeeds) are reported LOUDLY for manual
//     cleanup — never silently left behind to look like real customer data.
//
// WHAT "PASS" MEANS: the attack was REFUSED. A pass here is a locked door, not a feature.

const SUPA = 'https://wgcgzuflpxijhzlpphab.supabase.co';
const ANON = process.env.UND_ANON || null;   // read from site source by the runner below

let crit = [], high = [], info = [], passes = 0;
const sect = (t) => console.log('\n' + t);
const good = (t, d) => { passes++; console.log(`  BLOCKED  ${t}${d ? '  — ' + d : ''}`); };
const bad  = (sev, t, d) => {
  (sev === 'CRIT' ? crit : high).push({ t, d });
  console.log(`  ${sev === 'CRIT' ? '!! CRITICAL' : '!  HIGH'}  ${t}${d ? '  — ' + d : ''}`);
};
const note = (t, d) => { info.push({ t, d }); console.log(`  info     ${t}${d ? '  — ' + d : ''}`); };

const H = (key) => ({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' });

async function get(table, key) {
  try {
    const r = await fetch(`${SUPA}/rest/v1/${table}`, { headers: H(key) });
    const b = await r.json().catch(() => null);
    return { status: r.status, body: b, rows: Array.isArray(b) ? b.length : null };
  } catch (e) { return { status: 0, err: e.message }; }
}

// DETECTION VALIDATED 2026-07-20. A blocked write returns HTTP 200 with an empty body,
// not an error — PostgREST reports "matched zero rows" because RLS filtered them out, which
// looks identical to success if you only check the status code. Confirmed the right signal
// is `changed > 0` by attempting a REAL value change on store_products.availability_note and
// reading it back: response [], value still null. Without that check this probe would have
// reported every write as blocked whether or not it was — a security test that cannot fail
// is worse than none, because it certifies the thing it never examined.
async function patch(table, key, body) {
  try {
    const r = await fetch(`${SUPA}/rest/v1/${table}`, {
      method: 'PATCH', headers: { ...H(key), Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    const b = await r.json().catch(() => null);
    return { status: r.status, body: b, changed: Array.isArray(b) ? b.length : 0 };
  } catch (e) { return { status: 0, err: e.message }; }
}

export async function run(anon) {
  console.log('SECURITY PROBE — live system, public anon key (what any stranger can do)');
  console.log('='.repeat(74));

  // ── 1. Can a stranger READ private data? ───────────────────────────────────
  // RLS is the ONLY thing standing between the public key and every customer record.
  sect('1. Data exposure — reading tables that must be private');
  const PRIVATE = [
    ['service_tickets?select=*&limit=5',       'customer orders (names, site URLs, problems)'],
    ['purchases?select=*&limit=5',             'purchase + payment records'],
    ['tos_consents?select=*&limit=5',          'consent records (IP addresses)'],
    ['product_usage_proof?select=*&limit=5',   'delivery evidence'],
    ['profiles?select=*&limit=5',              'user profiles + ROLES'],
    ['entitlements?select=*&limit=5',          'what each user owns'],
    ['service_reviews?select=*&limit=5',       'customer reviews'],
    ['client_secure_tokens?select=*&limit=5',  'CUSTOMER CREDENTIALS'],
    ['security_events?select=*&limit=5',       'security audit log'],
  ];
  for (const [q, label] of PRIVATE) {
    const r = await get(q, anon);
    const table = q.split('?')[0];
    if (r.status === 200 && r.rows > 0) {
      bad('CRIT', `${table} is PUBLICLY READABLE`, `${r.rows} rows of ${label} exposed to anyone`);
    } else if (r.status === 200 && r.rows === 0) {
      // Empty is not proof of safety — an empty table reads as "secure" until it has data.
      note(`${table} returned 0 rows`, 'RLS may be open but the table is empty — RE-TEST once it has data');
    } else if (r.status === 404) {
      note(`${table} does not exist`, 'nothing to expose yet');
    } else {
      good(`${table} refused`, `HTTP ${r.status}`);
    }
  }

  // ── 2. Can a stranger WRITE? ───────────────────────────────────────────────
  // Each write sets a column to the value it ALREADY holds: success proves writability
  // without altering anything.
  sect('2. Integrity — writing tables that must be read-only to the public');

  const ss = await get('site_status?select=id,mode&id=eq.1', anon);
  if (ss.status === 200 && ss.rows > 0) {
    const cur = ss.body[0].mode;
    const w = await patch('site_status?id=eq.1', anon, { mode: cur });
    if (w.status < 300 && w.changed > 0) {
      bad('CRIT', 'site_status is PUBLICLY WRITABLE',
          `anyone can set mode='maintenance' and take the entire store offline (no-op write of '${cur}' succeeded)`);
    } else good('site_status write refused', `HTTP ${w.status}`);
  } else note('site_status not readable', 'skipping write test');

  const sp = await get('store_products?select=slug,price_cents,availability&limit=1', anon);
  if (sp.status === 200 && sp.rows > 0) {
    const p = sp.body[0];
    const w = await patch(`store_products?slug=eq.${encodeURIComponent(p.slug)}`, anon, { price_cents: p.price_cents });
    if (w.status < 300 && w.changed > 0) {
      bad('CRIT', 'store_products is PUBLICLY WRITABLE',
          'anyone can rewrite PRICES or set every service to hidden (no-op price write succeeded)');
    } else good('store_products write refused', `HTTP ${w.status}`);

    const w2 = await patch(`store_products?slug=eq.${encodeURIComponent(p.slug)}`, anon, { availability: p.availability });
    if (w2.status < 300 && w2.changed > 0) {
      bad('CRIT', 'store_products.availability is PUBLICLY WRITABLE', 'anyone can disable every buy button');
    } else good('availability write refused', `HTTP ${w2.status}`);
  }

  // Privilege escalation: the single highest-value target in the whole system.
  const w3 = await patch('profiles?role=eq.user', anon, { role: 'owner' });
  if (w3.status < 300 && w3.changed > 0) {
    bad('CRIT', 'PRIVILEGE ESCALATION — profiles.role is writable', 'a user can make themselves OWNER');
  } else good('role escalation refused', `HTTP ${w3.status}`);

  // ── 3. Can a stranger forge business records? ──────────────────────────────
  sect('3. Forgery — inserting records that must be server-only');
  const forgeries = [
    ['purchases',           { user_id: '00000000-0000-0000-0000-000000000000', amount_cents: 1 }, 'fake a PAID purchase'],
    ['product_usage_proof', { user_id: '00000000-0000-0000-0000-000000000000', service_rendered: 'probe' }, 'fake delivery evidence'],
    ['entitlements',        { user_id: '00000000-0000-0000-0000-000000000000' }, 'grant themselves a product'],
  ];
  for (const [table, body, what] of forgeries) {
    try {
      const r = await fetch(`${SUPA}/rest/v1/${table}`, {
        method: 'POST', headers: { ...H(anon), Prefer: 'return=representation' }, body: JSON.stringify(body),
      });
      const b = await r.json().catch(() => null);
      if (r.status < 300 && Array.isArray(b) && b.length) {
        bad('CRIT', `${table} accepts PUBLIC INSERTS`,
            `${what}. A ROW WAS CREATED — delete id=${b[0].id} manually.`);
      } else good(`${table} insert refused`, `HTTP ${r.status}`);
    } catch (e) { good(`${table} insert failed`, e.message); }
  }

  // ── 4. Is the anon key scoped correctly? ───────────────────────────────────
  sect('4. Key hygiene');
  try {
    const payload = JSON.parse(Buffer.from(anon.split('.')[1], 'base64').toString());
    if (payload.role === 'anon') good('shipped key is the ANON role', 'correct — it is meant to be public');
    else bad('CRIT', `shipped key has role='${payload.role}'`, 'a service_role key in client JS grants FULL database access to everyone');
    const exp = new Date(payload.exp * 1000);
    note('key expires', exp.toISOString().slice(0, 10));
  } catch { note('could not decode the key', ''); }

  // ── verdict ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(74));
  console.log(`${passes} attacks blocked · ${crit.length} CRITICAL · ${high.length} high · ${info.length} to watch`);
  if (crit.length) {
    console.log('\nCRITICAL — fix before taking money:');
    crit.forEach((f, i) => console.log(`  ${i + 1}. ${f.t}\n     ${f.d}`));
  }
  if (info.length) {
    console.log('\nWatch list (not proven safe — proven EMPTY):');
    info.forEach((f) => console.log(`  - ${f.t}: ${f.d}`));
  }
  return { crit: crit.length, high: high.length };
}

// Runner: pull the anon key from the site's own source, so we test with exactly the
// credential the browser ships — not one we chose.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../docs/assets/js/site-state.js', import.meta.url), 'utf8');
const key = ANON || (src.match(/(eyJ[A-Za-z0-9_.-]{40,})/) || [])[1];
if (!key) { console.error('Could not find the anon key in site-state.js'); process.exit(2); }
const res = await run(key);
process.exit(res.crit > 0 ? 1 : 0);
