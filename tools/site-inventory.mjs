#!/usr/bin/env node
// site-inventory.mjs — generates SITE-MAP.md: what this website ACTUALLY has, and whether it works.
//
// WHY THIS EXISTS
// Alex, 2026-07-31: "your records or the website records didn't say none of it, and that's what
// confused you — then you should write that down."
//
// He is exactly right, and it is the root cause of a failure I repeated three times in one day:
//   - I said 8 services were dead behind "placeholder Stripe links" and told him the fix was 30
//     minutes in the Stripe dashboard. There are no payment links in the working path at all.
//   - I said the card "details" feature was missing. It existed, fully written, wired to
//     [data-details] elements that did not exist in the HTML. Nothing could ever trigger it.
//   - I said the store page was empty because `curl` returned no product markup. It has FIFTEEN
//     products. They render client-side from Supabase, which curl cannot execute.
//
// Every one of those was the same mistake: rebuilding a mental model of the site by grep, in a
// hurry, with no written record to check against. There is an inventory for the 70 SYSTEMS on this
// machine (asset-registry.mjs -> E:\ASSET-MAP.md) and there has never been one for the WEBSITE.
//
// A hand-written list would rot within a week, so this is GENERATED. Same principle as the asset
// map: never hand-write an inventory, because a stale map lies more convincingly than no map.
//
// WHAT IT REPORTS THAT A GREP CANNOT
//   1. DEAD WIRING. For every selector the JS binds to (querySelectorAll('[x]'), getElementById),
//      it counts matching elements in the HTML. Zero matches = the handler can never fire. That is
//      exactly the defect that hid the details modal for weeks.
//   2. CLIENT-RENDERED PAGES. Pages whose content arrives at runtime are flagged loudly, so nobody
//      (me) ever again concludes "this page is empty" from source. Source inspection is NOT
//      sufficient for those pages and the map says so in those words.
//   3. THE BUY SURFACE. Which pages can take money, through which mechanism.
//
// READ-ONLY. Reads files, writes one markdown file. Runs no code from the site.
//
// USAGE
//   node tools/site-inventory.mjs            # write SITE-MAP.md
//   node tools/site-inventory.mjs --check    # exit 1 if any DEAD wiring is found (CI gate)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const JSDIR = join(DOCS, 'assets', 'js');
const CHECK_ONLY = process.argv.includes('--check');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

const pages = readdirSync(DOCS).filter((f) => f.endsWith('.html')).sort();
const scripts = existsSync(JSDIR) ? readdirSync(JSDIR).filter((f) => f.endsWith('.js')).sort() : [];

// ── 1. What does each script BIND to? ────────────────────────────────────────
// A handler attached to a selector that matches nothing is dead code wearing a feature's name.
const bindings = []; // { script, kind, token }
for (const s of scripts) {
  const src = read(join(JSDIR, s)) || '';
  // Strip comments first. Matching inside a comment produced a false "dead wiring" report once
  // already today, and a verifier that cries wolf gets muted.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Only LITERAL ids. `getElementById('si-form-' + idx)` builds the id at runtime, so the captured
  // text is a PREFIX, not an element name - it will never match any HTML and reporting it as dead
  // is noise. Eight of the first nine findings were exactly this. The trailing quote must be
  // followed by a closing paren, not a concatenation.
  for (const m of code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    bindings.push({ script: s, kind: 'id', token: m[1] });
  }
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*['"]\[([a-zA-Z0-9_-]+)[\]=]/g)) {
    bindings.push({ script: s, kind: 'attr', token: m[1] });
  }
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*['"]\.([a-zA-Z0-9_-]+)['"]/g)) {
    bindings.push({ script: s, kind: 'class', token: m[1] });
  }
}

// ── 2. Per page: what loads, what renders, what can take money ───────────────
const report = [];
const deadFindings = [];

for (const p of pages) {
  const html = read(join(DOCS, p)) || '';
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '(no title)';
  const localScripts = [...html.matchAll(/<script[^>]+src="assets\/js\/([^"]+)"/g)].map((m) => m[1]);
  const cdnScripts = [...html.matchAll(/<script[^>]+src="(https:\/\/[^"]+)"/g)]
    .map((m) => m[1].replace(/^https:\/\/([^/]+).*/, '$1'));

  const buy = {
    dataPay: (html.match(/data-pay=/g) || []).length,
    addToCart: (html.match(/Add to Cart/g) || []).length,
    comingSoon: (html.match(/Coming Soon/g) || []).length,
    cartPanel: /id="cart-panel"/.test(html),
    forms: (html.match(/<form/g) || []).length,
  };

  // A page that pulls Supabase and has almost no static content is rendering at runtime.
  const usesSupabase = cdnScripts.some((c) => /supabase/.test(c)) ||
                       localScripts.some((s) => /store|services|dashboard/.test(s));
  const staticBodyLen = (html.match(/<body[\s\S]*<\/body>/) || [''])[0].length;
  const clientRendered = usesSupabase && buy.dataPay === 0 && staticBodyLen < 22000 &&
                         /filter|search|catalog|grid|list/i.test(html);

  report.push({ page: p, title, html, localScripts, cdnScripts: [...new Set(cdnScripts)], buy, clientRendered });
}

// ── 2b. DEAD WIRING, judged SITE-WIDE ────────────────────────────────────────
// The first version of this checked each binding against only the page being examined and reported
// 19 false positives on the first run. main.js is loaded on EVERY page and legitimately binds to
// store controls that exist only on store.html and operator controls that exist only on the admin
// page. Flagging those as "dead" on verified.html is noise, and a checker that cries wolf gets
// muted - which is the precise failure this whole file exists to catch. I built the defect into the
// detector for it.
//
// The honest condition is site-wide: a binding is DEAD only when NO page that loads that script has
// a matching element anywhere. That is the real "this handler can never fire" test, and it is what
// caught the details modal ([data-details] present in JS and CSS, zero elements in any HTML).
//
// Client-rendered pages are excluded from providing matches OR from being blamed: their elements are
// created at runtime, so their HTML proves nothing in either direction. A binding whose only possible
// home is a client-rendered page is reported as UNPROVABLE, never as dead.
const matchCount = (html, b) => {
  if (b.kind === 'id')    return (html.match(new RegExp('id="' + b.token + '"', 'g')) || []).length;
  if (b.kind === 'attr')  return (html.match(new RegExp('\\s' + b.token + '[=\\s>]', 'g')) || []).length;
  if (b.kind === 'class') return (html.match(new RegExp('class="[^"]*\\b' + b.token + '\\b', 'g')) || []).length;
  return 0;
};

const unprovable = [];
const seen = new Set();
for (const b of bindings) {
  const key = b.script + '|' + b.kind + '|' + b.token;
  if (seen.has(key)) continue;
  seen.add(key);

  const hosts = report.filter((r) => r.localScripts.includes(b.script));
  if (!hosts.length) continue;                       // script loaded by no page at all

  const totalMatches = hosts.reduce((n, r) => n + matchCount(r.html, b), 0);
  if (totalMatches > 0) continue;                    // it lives somewhere in the HTML - not dead

  // NOT IN THE HTML IS NOT THE SAME AS DEAD.
  // Second false-positive round: services.js builds its whole modal with innerHTML and then queries
  // the pieces (.svc-modal-title, .svc-modal-go ...); site-state.js creates #und-banner and
  // #und-splash the same way. Those elements are never in any .html file and are perfectly alive.
  // So before calling anything dead, ask whether the script CREATES it.
  //
  // This is the distinction that actually matters. [data-details] was genuinely dead precisely
  // because NOTHING created it - not the HTML, and not the JS either. That is the signature to hunt:
  // queried, styled, never constructed.
  const src = read(join(JSDIR, b.script)) || '';
  const t = b.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selfCreates =
    new RegExp('class=\\\\?["\'][^"\']*\\b' + t + '\\b').test(src) ||   // class="... token ..." in a template
    new RegExp('id=\\\\?["\']' + t + '\\b').test(src) ||                // id="token" in a template
    new RegExp('\\b' + t + '\\b\\s*[=:]').test(src) ||                  // token used as an attribute name
    new RegExp('createElement[\\s\\S]{0,200}' + t).test(src);           // built then labelled
  if (selfCreates) continue;

  if (hosts.every((r) => r.clientRendered)) {
    unprovable.push({ ...b, pages: hosts.map((r) => r.page).join(', ') });
  } else {
    deadFindings.push({ ...b, pages: hosts.filter((r) => !r.clientRendered).map((r) => r.page).join(', ') });
  }
}

// ── 3. Write the map ─────────────────────────────────────────────────────────
const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
const L = [];
L.push('# SITE MAP — what universalnetworkdevelopment.com actually has');
L.push('');
L.push('**GENERATED — do not hand-edit.** `node tools/site-inventory.mjs`');
L.push('Generated: ' + now + ' · ' + pages.length + ' pages · ' + scripts.length + ' scripts');
L.push('');
L.push('> Written because the same mistake happened three times in one day: rebuilding a picture of');
L.push('> this site by grep and getting it wrong. A grep of the source cannot tell you whether a');
L.push('> feature is REACHABLE, and it cannot see anything rendered at runtime.');
L.push('');
L.push('## HOW THIS RELATES TO MASTERPLAN.md — read this before using either');
L.push('');
L.push('There are two documents describing this site and they have **different jobs**. Confusing them');
L.push('is how you end up trusting the wrong one.');
L.push('');
L.push('| | **SITE-MAP.md** (this file) | **MASTERPLAN.md** |');
L.push('|---|---|---|');
L.push('| What it is | GENERATED facts | HAND-WRITTEN intent + planning |');
L.push('| Answers | what EXISTS and whether it is REACHABLE | what it is FOR and where it is going |');
L.push('| Freshness | regenerate any time; cannot rot | **content dated 2026-05-19 — check before trusting** |');
L.push('| Git | tracked | **gitignored, PRIVATE / trade secret — never commit** |');
L.push('');
L.push('**Neither replaces the other.** This file cannot tell you why a thing exists; MASTERPLAN');
L.push('cannot tell you whether it still works. **On any question of current fact, THIS file wins** —');
L.push('it was generated from the code, MASTERPLAN was written by a human months ago and still says');
L.push('"Impl Status: COMPLETE - all critical/high/medium gaps resolved", which was already false when');
L.push('the cart broke four weeks later and stayed broken for six.');
L.push('');

const cr = report.filter((r) => r.clientRendered);
if (cr.length) {
  L.push('## ⚠ CLIENT-RENDERED PAGES — SOURCE INSPECTION IS NOT SUFFICIENT');
  L.push('');
  L.push('These pages build their content at runtime from Supabase. `curl`, `grep` and "view source"');
  L.push('**will show an empty page and that means nothing.** To know what is on them you must load');
  L.push('them in a real browser. On 2026-07-31 store.html was reported as an empty filter UI on this');
  L.push('exact basis; it actually renders **15 products**.');
  L.push('');
  for (const r of cr) L.push('- **' + r.page + '** — ' + r.title);
  L.push('');
}

L.push('## THE BUY SURFACE — which pages can take money');
L.push('');
L.push('| Page | data-pay | Add to Cart | Coming Soon | cart panel | forms |');
L.push('|---|---|---|---|---|---|');
for (const r of report) {
  const b = r.buy;
  if (b.dataPay || b.addToCart || b.cartPanel) {
    L.push('| ' + r.page + ' | ' + b.dataPay + ' | ' + b.addToCart + ' | ' + b.comingSoon + ' | ' +
           (b.cartPanel ? 'yes' : '-') + ' | ' + b.forms + ' |');
  }
}
L.push('');
L.push('**Note:** "Coming Soon" in the static HTML is the FAIL-CLOSED default. Every buy button ships');
L.push('disabled and JavaScript only ever UNLOCKS, based on `store_products.availability` in Supabase.');
L.push('So a Coming Soon count here does NOT mean the service is unavailable to a real visitor.');
L.push('');

L.push('## DEAD WIRING — handlers bound to elements that do not exist');
L.push('');
if (deadFindings.length === 0) {
  L.push('None found. Every selector the page-loaded scripts bind to matches at least one element.');
} else {
  L.push('**' + deadFindings.length + ' binding(s) match ZERO elements.** The handler can never fire,');
  L.push('so the feature is unreachable no matter how complete the code looks.');
  L.push('');
  L.push('| Script | Binds to | Kind | Pages that load it |');
  L.push('|---|---|---|---|');
  for (const d of deadFindings) {
    L.push('| ' + d.script + ' | `' + d.token + '` | ' + d.kind + ' | ' + d.pages + ' |');
  }
}
L.push('');

L.push('## EVERY PAGE');
L.push('');
for (const r of report) {
  L.push('### ' + r.page);
  L.push('- **Title:** ' + r.title);
  if (r.localScripts.length) L.push('- **Scripts:** ' + r.localScripts.join(', '));
  if (r.cdnScripts.length)   L.push('- **External:** ' + r.cdnScripts.join(', '));
  if (r.clientRendered)      L.push('- **⚠ CLIENT-RENDERED** — you cannot tell what is on this page from the source.');
  L.push('');
}

if (!CHECK_ONLY) {
  writeFileSync(join(ROOT, 'SITE-MAP.md'), L.join('\n'), 'utf8');
  console.log('\nSITE-MAP.md written — ' + pages.length + ' pages, ' + scripts.length + ' scripts.');
  console.log('  client-rendered pages : ' + cr.length + (cr.length ? ' (' + cr.map(r => r.page).join(', ') + ')' : ''));
  console.log('  dead wiring findings  : ' + deadFindings.length + '   (unprovable, client-rendered only: ' + unprovable.length + ')');
  for (const d of deadFindings) console.log('    DEAD  ' + d.script + '  [' + d.token + ']  (pages: ' + d.pages + ')');
  console.log('');
} else {
  console.log('dead wiring: ' + deadFindings.length);
  for (const d of deadFindings) console.log('  DEAD  ' + d.script + '  [' + d.token + ']  (pages: ' + d.pages + ')');
}

process.exit(CHECK_ONLY && deadFindings.length ? 1 : 0);
