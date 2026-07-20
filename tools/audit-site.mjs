#!/usr/bin/env node
// tools/audit-site.mjs — U.N.D static site auditor
// ============================================================================
// Reads the frontend (docs/) and reports, from CODE alone (no browser):
//   MAP      — every page, its title, and which shared assets it loads
//   HEAD     — pages missing charset / viewport / title (real render bugs)
//   NAV/FOOT — cross-page drift in the nav and footer (the fan-page legacy)
//   LINKS    — internal <a href="*.html"> that point at a missing page
//   ASSETS   — src/href to /assets/* that don't exist on disk (broken img/css/js)
//   CSSVARS  — var(--x) used but never defined (renders wrong / invisible)
//   CLASSES  — class="..." used in HTML but never defined in CSS (unstyled)
//   IDS      — duplicate id="" on one page (breaks JS + a11y)
//   IMG      — <img> without alt (a11y + broken-image UX)
//
// Heuristic (regex, not a full parser) but high-signal on a hand-written site.
// Run:  node tools/audit-site.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const cap = (arr, n = 20) => arr.slice(0, n).concat(arr.length > n ? ['  …+' + (arr.length - n) + ' more'] : []);
const uniq = (a) => [...new Set(a)];

const htmlFiles = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'));
const pages = htmlFiles.map((f) => ({ name: f, src: fs.readFileSync(path.join(DOCS, f), 'utf8') }));

// gather CSS (all stylesheets under docs)
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allFiles = walk(DOCS);
// Definition sources = external stylesheets PLUS every page's inline <style> block.
// (A class/var defined in an inline <style> is still defined — not scanning these
//  produced false "undefined" reports.)
const externalCss = allFiles.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const inlineCss = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'))
  .map((f) => (fs.readFileSync(path.join(DOCS, f), 'utf8').match(/<style\b[\s\S]*?<\/style>/gi) || []).join('\n'))
  .join('\n');
const cssText = externalCss + '\n' + inlineCss;

const attr = (html, re) => { const out = []; let m; while ((m = re.exec(html))) out.push(m[1]); return out; };
const block = (html, tag) => {
  const m = new RegExp('<' + tag + '[\\s\\S]*?</' + tag + '>', 'i').exec(html);
  return m ? m[0] : '';
};

const report = [];
const say = (s) => report.push(s);

// ── MAP ─────────────────────────────────────────────────────────────────────
say('# SITE MAP (' + pages.length + ' pages)\n');
for (const p of pages) {
  const title = (/<title>([\s\S]*?)<\/title>/i.exec(p.src) || [, '(none)'])[1].trim().slice(0, 40);
  const loads = [];
  if (/assets\/js\/main\.js/.test(p.src)) loads.push('main.js');
  if (/assets\/css\/styles\.css/.test(p.src)) loads.push('styles.css');
  if (/<nav/i.test(p.src)) loads.push('nav');
  if (/<footer/i.test(p.src)) loads.push('footer');
  say('  ' + p.name.padEnd(26) + '"' + title + '"'.padEnd(42) + ' [' + loads.join(', ') + ']');
}

// ── HEAD essentials ──────────────────────────────────────────────────────────
say('\n# HEAD — missing render essentials');
let headProblems = 0;
for (const p of pages) {
  const miss = [];
  if (!/<meta[^>]+charset/i.test(p.src)) miss.push('charset');
  if (!/name=["']viewport["']/i.test(p.src)) miss.push('viewport');
  if (!/<title>/i.test(p.src)) miss.push('title');
  if (miss.length) { say('  ' + p.name.padEnd(26) + 'missing: ' + miss.join(', ')); headProblems++; }
}
if (!headProblems) say('  ok — all pages have charset, viewport, title');

// ── NAV / FOOTER drift ───────────────────────────────────────────────────────
function linksOf(html) {
  return uniq(attr(html, /href=["']([^"'#]+)["']/gi).filter((h) => h.endsWith('.html')));
}
function driftReport(tag) {
  const havers = pages.filter((p) => new RegExp('<' + tag, 'i').test(p.src));
  const sets = havers.map((p) => ({ name: p.name, links: linksOf(block(p.src, tag)) }));
  // canonical = the most common link-set signature
  const sig = (l) => l.slice().sort().join('|');
  const counts = {};
  sets.forEach((s) => { counts[sig(s.links)] = (counts[sig(s.links)] || 0) + 1; });
  const canonSig = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const canon = canonSig.split('|');
  say('\n# ' + tag.toUpperCase() + ' drift (' + havers.length + ' pages; canonical has ' + canon.length + ' links)');
  let drift = 0;
  for (const s of sets) {
    if (sig(s.links) === canonSig) continue;
    const missing = canon.filter((l) => !s.links.includes(l));
    const extra = s.links.filter((l) => !canon.includes(l));
    const parts = [];
    if (missing.length) parts.push('missing ' + JSON.stringify(missing));
    if (extra.length) parts.push('extra ' + JSON.stringify(extra));
    say('  ' + s.name.padEnd(26) + parts.join('; '));
    drift++;
  }
  if (!drift) say('  ok — identical across all ' + havers.length + ' pages');
}
driftReport('nav');
driftReport('footer');

// ── Broken internal links ────────────────────────────────────────────────────
say('\n# BROKEN internal links (href to a page that does not exist)');
const pageNames = new Set(htmlFiles);
let broken = 0;
for (const p of pages) {
  const targets = uniq(attr(p.src, /href=["']([^"']+\.html)(?:[#?][^"']*)?["']/gi))
    .filter((h) => !/^https?:|^\/\//.test(h))
    .map((h) => h.replace(/^\.?\//, '').split(/[#?]/)[0]);
  const bad = targets.filter((t) => !pageNames.has(t) && !fs.existsSync(path.join(DOCS, t)));
  if (bad.length) { say('  ' + p.name.padEnd(26) + uniq(bad).join(', ')); broken += bad.length; }
}
if (!broken) say('  ok — no broken page links');

// ── Missing assets ───────────────────────────────────────────────────────────
say('\n# MISSING assets (src/href to /assets/* not found on disk)');
let missAsset = 0;
const seenAsset = new Set();
for (const p of pages) {
  const refs = uniq(attr(p.src, /(?:src|href)=["']([^"']*assets\/[^"']+)["']/gi))
    .map((r) => r.replace(/^\.?\//, '').split(/[#?]/)[0]);
  for (const r of refs) {
    const key = p.name + '|' + r;
    if (seenAsset.has(key)) continue; seenAsset.add(key);
    if (!fs.existsSync(path.join(DOCS, r))) { say('  ' + p.name.padEnd(26) + r); missAsset++; }
  }
}
if (!missAsset) say('  ok — every referenced asset exists');

// ── CSS variables used but never defined ─────────────────────────────────────
const htmlAll = pages.map((p) => p.src).join('\n');
const definedVars = new Set(attr(cssText, /--([A-Za-z0-9_-]+)\s*:/g));
const usedVars = uniq(attr(cssText + htmlAll, /var\(\s*--([A-Za-z0-9_-]+)/g));
const undefVars = usedVars.filter((v) => !definedVars.has(v));
say('\n# CSS VARIABLES used but never defined (' + definedVars.size + ' defined, ' + usedVars.length + ' used)');
say(undefVars.length ? cap(undefVars).map((v) => '  --' + v).join('\n') : '  ok — every var() has a definition');

// ── Classes used in HTML but never defined in CSS ────────────────────────────
const definedClasses = new Set(attr(cssText, /\.(-?[A-Za-z_][\w-]*)/g));
const usedClasses = uniq(
  attr(htmlAll, /class=["']([^"']+)["']/g).flatMap((c) => c.split(/\s+/)).filter(Boolean)
);
const undefClasses = usedClasses.filter((c) => !definedClasses.has(c));
say('\n# CLASSES used in HTML but not defined in CSS (' + usedClasses.length + ' used, ' + definedClasses.size + ' defined) — likely unstyled');
say(undefClasses.length ? cap(undefClasses, 40).map((c) => '  .' + c).join('\n') : '  ok');

// ── Duplicate IDs per page ───────────────────────────────────────────────────
say('\n# DUPLICATE ids on a single page (breaks getElementById + a11y)');
let dupIds = 0;
for (const p of pages) {
  const ids = attr(p.src, /\bid=["']([^"']+)["']/g);
  const seen = {}, dup = [];
  ids.forEach((i) => { seen[i] = (seen[i] || 0) + 1; if (seen[i] === 2) dup.push(i); });
  if (dup.length) { say('  ' + p.name.padEnd(26) + dup.join(', ')); dupIds += dup.length; }
}
if (!dupIds) say('  ok — no duplicate ids');

// ── Images without alt ───────────────────────────────────────────────────────
say('\n# <img> without alt=');
let noAlt = 0;
for (const p of pages) {
  const imgs = p.src.match(/<img\b[^>]*>/gi) || [];
  const bad = imgs.filter((t) => !/\balt=/i.test(t)).length;
  if (bad) { say('  ' + p.name.padEnd(26) + bad + ' image(s)'); noAlt += bad; }
}
if (!noAlt) say('  ok — every <img> has alt');

console.log(report.join('\n'));
