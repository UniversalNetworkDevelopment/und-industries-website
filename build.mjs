#!/usr/bin/env node
// build.mjs — inject the shared site chrome (nav + footer) into every page.
// ============================================================================
// Single source of truth:  partials/nav.html  +  partials/footer.html
// Edit those ONE files, run `node build.mjs`, and every page re-syncs.
//
// This replaces the old update_nav.js, which literal-string-matched one specific
// nav change and silently skipped any page whose markup had drifted — the reason
// the nav/footer fell out of sync across 20 pages in the first place.
//
// How a page opts in:  it simply contains <nav class="nav"> / <footer class="footer">.
// Pages listed in EXCLUDE keep their own chrome (e.g. a logged-in app shell).
// Idempotent: run it as many times as you like; the result is identical.
//
// Run:  node build.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(ROOT, 'docs');

// Pages that intentionally keep a DIFFERENT chrome. Add filenames here to skip.
// (dashboard.html already uses a different nav and is not matched at all.)
const EXCLUDE = new Set([]);

const nav = fs.readFileSync(path.join(ROOT, 'partials', 'nav.html'), 'utf8').replace(/\s+$/, '');
const footer = fs.readFileSync(path.join(ROOT, 'partials', 'footer.html'), 'utf8').replace(/\s+$/, '');

// Match the whole element incl. its leading indentation; replace like-for-like.
const NAV_RE = /[ \t]*<nav class="nav"[\s\S]*?<\/nav>/;
const FOOTER_RE = /[ \t]*<footer class="footer"[\s\S]*?<\/footer>/;

const files = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'));
let changed = 0, navCount = 0, footCount = 0, skipped = 0;
const touched = [];
const warnings = [];

for (const f of files) {
  if (EXCLUDE.has(f)) { skipped++; continue; }
  const p = path.join(DOCS, f);
  let html = fs.readFileSync(p, 'utf8');
  const before = html;

  const navHits = (html.match(/<nav class="nav"/g) || []).length;
  if (navHits === 1) html = html.replace(NAV_RE, () => nav), navCount++;
  else if (navHits > 1) warnings.push(f + ': ' + navHits + ' nav.nav blocks — nav left untouched');

  const footHits = (html.match(/<footer class="footer"/g) || []).length;
  if (footHits === 1) html = html.replace(FOOTER_RE, () => footer), footCount++;
  else if (footHits > 1) warnings.push(f + ': ' + footHits + ' footer.footer blocks — footer left untouched');

  if (html !== before) { fs.writeFileSync(p, html); changed++; touched.push(f); }
}

console.log('build.mjs — shared chrome sync');
console.log('  pages changed  : ' + changed);
console.log('  nav injected   : ' + navCount);
console.log('  footer injected: ' + footCount);
if (skipped) console.log('  excluded       : ' + skipped);
if (touched.length) console.log('  touched        : ' + touched.join(', '));
if (warnings.length) { console.log('  WARNINGS:'); warnings.forEach((w) => console.log('    ! ' + w)); }
