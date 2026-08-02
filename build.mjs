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
// execFileSync with an argument array, never a shell string — no interpolation, no shell.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

// ── ASSET CACHE BUSTING ─────────────────────────────────────────────────────
// Added 2026-08-02 after PROVING a deployed JS fix was not reaching browsers. Measured live:
// the cached /assets/js/services.js was 42,801 bytes and lacked a change that had already
// deployed; the same URL fetched with a cache-buster returned 45,707 bytes and had it.
//
// The CSS carried a hand-typed ?v=1781800001. The JS carried nothing. So every client-side fix
// could sit behind a stale cache while looking deployed — and a version number a human has to
// remember will be forgotten on exactly the deploy that mattered.
//
// A Cache-Control header alone is NOT enough: docs/_headers sets max-age=0, must-revalidate and
// Cloudflare rewrites it to max-age=14400 with its own Browser Cache TTL default. A changed URL
// is the only bust the CDN cannot override.
//
// Hash the CONTENT, not the clock. An unchanged file keeps its URL and stays cached — which is
// the whole point of caching — and only a file that actually changed gets a new one.
const assetVersion = (rel) => {
  try {
    const buf = fs.readFileSync(path.join(DOCS, rel));
    return createHash('sha256').update(buf).digest('hex').slice(0, 10);
  } catch { return null; }
};

function stampAssets(html) {
  // Local assets only. A protocol-relative or absolute URL (the Supabase CDN, Cloudflare
  // insights) is somebody else's file and must never be rewritten.
  return html.replace(
    /((?:src|href)=")(assets\/(?:js|css)\/[A-Za-z0-9._-]+\.(?:js|css))(?:\?v=[^"]*)?(")/g,
    (m, pre, rel, post) => {
      const v = assetVersion(rel);
      return v ? `${pre}${rel}?v=${v}${post}` : m;   // missing file: leave it exactly as found
    },
  );
}

const files = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'));
let changed = 0, navCount = 0, footCount = 0, skipped = 0, stamped = 0;
const touched = [];
const warnings = [];

for (const f of files) {
  const p = path.join(DOCS, f);
  let html = fs.readFileSync(p, 'utf8');
  const before = html;

  // EXCLUDE opts a page out of the SHARED CHROME only — it must still get asset stamping. A stale
  // dashboard.js is exactly as broken as a stale services.js, and dashboard.html is on that list.
  // (Before 2026-08-02 this loop `continue`d here, so an early return would have silently skipped
  // cache-busting on precisely the logged-in pages that carry the customer's own data.)
  const chromeExcluded = EXCLUDE.has(f);
  if (chromeExcluded) {
    skipped++;
  } else {
    const navHits = (html.match(/<nav class="nav"/g) || []).length;
    if (navHits === 1) html = html.replace(NAV_RE, () => nav), navCount++;
    else if (navHits > 1) warnings.push(f + ': ' + navHits + ' nav.nav blocks — nav left untouched');

    const footHits = (html.match(/<footer class="footer"/g) || []).length;
    if (footHits === 1) html = html.replace(FOOTER_RE, () => footer), footCount++;
    else if (footHits > 1) warnings.push(f + ': ' + footHits + ' footer.footer blocks — footer left untouched');
  }

  const preStamp = html;
  html = stampAssets(html);
  if (html !== preStamp) stamped++;

  if (html !== before) { fs.writeFileSync(p, html); changed++; touched.push(f); }
}

// ── BUILD STAMP — so "did my push actually deploy?" stops being unanswerable ──
//
// There was no way to tell whether the code running on universalnetworkdevelopment.com matched
// the code in the repo. A push is not a deploy: if the Cloudflare build fails, the site keeps
// serving the OLD code and nothing anywhere says so. That is this ecosystem's one recurring
// defect - a state nobody verifies - sitting on the deployment layer.
//
// Cloudflare Pages sets CF_PAGES_COMMIT_SHA during the build, so stamping it here means the
// LIVE SITE carries proof of exactly which commit produced it. tools/deploy-verify.mjs then
// compares that against local git HEAD. Locally (no CF vars) it falls back to git so the file
// is still meaningful during development.
try {
  const sha =
    process.env.CF_PAGES_COMMIT_SHA ||
    (() => { try { return execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })();
  const info = {
    commit: sha,
    shortCommit: sha ? sha.slice(0, 7) : null,
    branch: process.env.CF_PAGES_BRANCH || null,
    builtAt: new Date().toISOString(),
    // Distinguishes a real Cloudflare build from someone running build.mjs on their laptop.
    builtBy: process.env.CF_PAGES_COMMIT_SHA ? 'cloudflare-pages' : 'local',
  };
  fs.writeFileSync(path.join(DOCS, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  console.log('  build stamp    : ' + (info.shortCommit || 'unknown') + ' (' + info.builtBy + ')');
} catch (e) {
  // A stamp failure must be loud. A silent miss would make deploy-verify report "no stamp",
  // which reads as "the deploy failed" - a false alarm is how a real alarm gets ignored.
  console.log('  !! BUILD STAMP FAILED: ' + e.message + ' — deploy-verify will not be able to check this build');
}

console.log('build.mjs — shared chrome sync');
console.log('  pages changed  : ' + changed);
console.log('  nav injected   : ' + navCount);
console.log('  footer injected: ' + footCount);
if (skipped) console.log('  excluded       : ' + skipped);
if (touched.length) console.log('  touched        : ' + touched.join(', '));
if (warnings.length) { console.log('  WARNINGS:'); warnings.forEach((w) => console.log('    ! ' + w)); }
