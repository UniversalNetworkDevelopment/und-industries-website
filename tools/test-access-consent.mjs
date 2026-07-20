// tools/test-access-consent.mjs
// Verifies the SITE-ACCESS AUTHORISATION recorded at service intake.
//
// WHY THIS EXISTS:
// We perform admin work inside customers' websites. Until 2026-07-19 the only thing standing
// behind that was a checkbox whose value was read to enable a button and then thrown away.
// There was no record of who authorised what, when, or on which property.
//
// WHAT THIS ACTUALLY CHECKS — the four ways this can be silently wrong:
//   1. The consent row uses columns that DO NOT EXIST on tos_consents. This is the exact bug
//      that hit product_usage_proof: invented columns, PostgREST 400s, the error is swallowed
//      by a catch, and the record is NEVER written while the code looks healthy. Columns are
//      parsed from the real .sql file, not typed in here from memory.
//   2. The authorisation text stops actually authorising anything (someone "simplifies" it
//      back into a promise to hand over credentials, which is not permission to enter).
//   3. The checkbox renders different words than the ones we store — the stored statement
//      would then be evidence of something the customer was never shown.
//   4. consent_id gets written to service_tickets, silently replacing the CHECKOUT agreement.
//
// Everything is read out of the real source files. Nothing is duplicated here, so drift in
// the source fails the test instead of quietly invalidating it.

import { readFileSync } from 'node:fs';

// ROOT is overridable so this test can be mutation-checked: point it at a deliberately
// broken copy and confirm the assertions actually go RED. A green test that cannot fail
// is worse than no test — it is a health check that reports OK because it never looked.
const ROOT = process.env.CONSENT_TEST_ROOT || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(ROOT + p, 'utf8');

const intake = read('docs/assets/js/service-intake.js');
const schema = read('supabase/legal_security_tickets.sql');

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); }
};

// ── 1. consent row columns must exist on tos_consents ────────────────────────
console.log('\n1. Consent row matches the real tos_consents schema');

const tableBlock = schema.match(/create table if not exists public\.tos_consents \(([\s\S]*?)\n\);/);
if (!tableBlock) {
  console.log('  FAIL  could not locate tos_consents DDL — test cannot verify anything');
  process.exit(1);
}
// Column name = first token of each line that isn't a constraint/comment.
const realColumns = new Set(
  tableBlock[1].split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('--') && !/^(primary|foreign|unique|check|constraint)\b/i.test(l))
    .map(l => l.split(/\s+/)[0])
    .filter(Boolean)
);
ok('parsed real columns from SQL', realColumns.size >= 7, [...realColumns].join(', '));

const rowBlock = intake.match(/var consentRow = \{([\s\S]*?)\n          \};/);
ok('found the consent row in service-intake.js', !!rowBlock);
if (rowBlock) {
  // Top-level keys only — `detail` is jsonb, anything may live inside it.
  const usedKeys = [...rowBlock[1].matchAll(/^\s{12}([a-z_]+):/gm)].map(m => m[1]);
  ok('consent row has keys', usedKeys.length > 0, usedKeys.join(', '));
  const invented = usedKeys.filter(k => !realColumns.has(k));
  ok('NO invented columns', invented.length === 0,
     invented.length ? 'INVENTED: ' + invented.join(', ') : 'all ' + usedKeys.length + ' exist');
  // user_id is NOT NULL and drives the RLS insert policy (user_id = auth.uid()).
  ok('writes user_id (NOT NULL + RLS predicate)', usedKeys.includes('user_id'));
  ok('writes doc + version (identifies WHICH agreement)',
     usedKeys.includes('doc') && usedKeys.includes('version'));
}

// ── 2. the RLS insert policy must actually admit this row ────────────────────
console.log('\n2. RLS lets the customer write their own consent');
const insertPolicy = schema.match(/create policy "insert own consent" on public\.tos_consents for insert with check \((.*?)\);/);
ok('insert policy exists', !!insertPolicy, insertPolicy ? insertPolicy[1] : 'MISSING');
ok('policy is user_id = auth.uid()', !!insertPolicy && /user_id\s*=\s*auth\.uid\(\)/.test(insertPolicy[1]));
ok('row supplies the session user id', /user_id:\s*sess2\.user\.id/.test(intake),
   'must be the authenticated uid or the insert is rejected');
// .select('id').single() after insert needs a SELECT policy too, or it errors on read-back.
ok('read-back is permitted (select policy covers own rows)',
   /create policy "read own consent" on public\.tos_consents for select using \([\s\S]*?user_id = auth\.uid\(\)/.test(schema));

// ── 3. the statement must actually authorise ─────────────────────────────────
console.log('\n3. The authorisation text authorises something');
const textBlock = intake.match(/var ACCESS_AUTH_TEXT =\n([\s\S]*?);\n/);
ok('found ACCESS_AUTH_TEXT', !!textBlock);
const authText = textBlock
  ? textBlock[1].split('\n').map(l => l.trim().replace(/^'|'\s*\+?$/g, '')).join('')
  : '';
ok('grants permission to ACCESS, not merely to hand over credentials',
   /\bauthorise\b|\bauthorize\b/i.test(authText) && /\baccess\b/i.test(authText));
ok('warrants AUTHORITY to grant it', /authorised to grant|authorized to grant|I own this property/i.test(authText));
ok('limits SCOPE to the ordered service', /sole purpose|only .{0,20}purpose|service I ordered/i.test(authText));
ok('states access is revocable', /revoke|revocable/i.test(authText));
ok('names the legal entity, not just the brand',
   /Universal Network Development/i.test(authText), 'an LLC must contract under its own name');

// ── 4. shown text == stored text ─────────────────────────────────────────────
console.log('\n4. What we show is what we store');
ok('checkbox renders ACCESS_AUTH_TEXT itself',
   /id="si-confirm-'[\s\S]{0,80}esc\(ACCESS_AUTH_TEXT\)/.test(intake),
   'no second hardcoded copy to drift out of sync');
ok('stored statement is the same constant',
   /statement:\s*ACCESS_AUTH_TEXT/.test(intake));
ok('version is stamped so old tickets keep their wording',
   /version:\s*ACCESS_TERMS_VERSION/.test(intake) && /terms_version:\s*ACCESS_TERMS_VERSION/.test(intake));

// ── 5. the checkout agreement link must survive ──────────────────────────────
console.log('\n5. The checkout agreement is not clobbered');
const ticketUpdate = intake.match(/\.update\(\{([\s\S]*?)\}\)/);
ok('found the ticket update', !!ticketUpdate);
ok('does NOT write consent_id onto the ticket',
   !!ticketUpdate && !/consent_id/.test(ticketUpdate[1]),
   'that column already holds the PURCHASE agreement (services.js)');
ok('access consent id is kept in order_details instead',
   /access_authorization\.consent_id = cIns\.data\.id/.test(intake));

// ── 6. evidence survives a consent-write failure ─────────────────────────────
console.log('\n6. Fail-open, but never fail-silent');
ok('the full statement is also stored on the ticket',
   /access_authorization:\s*\{[\s\S]{0,400}statement:\s*ACCESS_AUTH_TEXT/.test(intake),
   'ticket copy is the fallback record');
ok('a failed consent insert is recorded, not swallowed',
   /consent_write_error/.test(intake) && /console\.error\('\[intake\] access consent insert failed'/.test(intake));
ok('a failed consent insert still submits the order',
   /\.catch\(function \(e\) \{[\s\S]{0,400}consent_write_error/.test(intake),
   'a bookkeeping bug must not block a paid customer');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
