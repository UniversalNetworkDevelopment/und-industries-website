#!/usr/bin/env node
// deploy-verify.mjs — answers "did my push actually reach the live site?"
//
// THE GAP THIS CLOSES
// Alex, 2026-07-27: "so there is no system to see if things succeeded?"
// There was not. You pushed, and nothing anywhere told you whether the code serving
// universalnetworkdevelopment.com matched the code in the repo. If a Cloudflare build failed, the
// site kept serving the OLD code and reported nothing. A green git push and a live deploy were
// unrelated events that everyone treated as the same thing.
//
// That is this ecosystem's one recurring defect - a state nobody verifies - sitting on the
// deployment layer, which is the last place you want it: it makes every OTHER fix unverifiable.
// "I fixed it" is false until the fix is actually being served.
//
// HOW IT WORKS
// build.mjs writes docs/build-info.json stamped with CF_PAGES_COMMIT_SHA (set by Cloudflare
// during the build). This fetches that file from the LIVE site and compares it to local git HEAD.
//   same commit      -> the deploy landed
//   different commit -> the live site is running OLDER code. Says how old.
//   404 / no stamp   -> the running deploy predates this tool, or the build never ran
//
// READ-ONLY. Fetches one public file. Changes nothing.
//
// USAGE
//   node tools/deploy-verify.mjs
//   node tools/deploy-verify.mjs --url https://staging.example.com
//   node tools/deploy-verify.mjs --json

import { execFileSync } from 'node:child_process';
// readFileSync is used below to read the LOCAL build stamp. It was missing, so that line threw
// ReferenceError, the bare `catch {}` swallowed it, and the code fell through to the commit
// comparison that can never match by construction — reporting STALE on a perfect deploy. The
// false alarm this file's own comments warn about, inside the file that warns about it.
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const urlIdx = argv.indexOf('--url');
const SITE = (urlIdx !== -1 && argv[urlIdx + 1]) || 'https://universalnetworkdevelopment.com';
const STAMP_URL = SITE.replace(/\/+$/, '') + '/build-info.json';

function localHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return null; }
}

// How many commits the live site is behind, in plain language. "It is behind" is a fact;
// "it is 3 commits and 6 hours behind" is something you can act on.
function commitsBetween(liveSha, headSha) {
  try {
    const out = execFileSync('git', ['rev-list', '--count', `${liveSha}..${headSha}`], { encoding: 'utf8' }).trim();
    return Number(out);
  } catch { return null; }
}

async function main() {
  const head = localHead();
  let stamp = null, fetchError = null, status = null;

  try {
    // cache: no-store — a CDN-cached stamp would let this report a stale deploy as current,
    // which is the exact failure it exists to catch.
    const res = await fetch(STAMP_URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    status = res.status;
    if (res.ok) {
      const text = await res.text();
      try { stamp = JSON.parse(text); }
      catch { fetchError = 'build-info.json is not valid JSON — got: ' + text.slice(0, 120); }
    } else {
      fetchError = `HTTP ${res.status}`;
    }
  } catch (e) {
    fetchError = String(e && e.message || e);
  }

  const result = {
    site: SITE,
    localHead: head,
    localShort: head ? head.slice(0, 7) : null,
    liveCommit: stamp ? stamp.commit : null,
    liveShort: stamp ? stamp.shortCommit : null,
    liveBuiltAt: stamp ? stamp.builtAt : null,
    liveBuiltBy: stamp ? stamp.builtBy : null,
    httpStatus: status,
    error: fetchError,
    verdict: null,
    behindBy: null,
  };

  if (!head) result.verdict = 'UNKNOWN — could not read local git HEAD';
  else if (fetchError && status === 404) {
    result.verdict = 'NO STAMP — the live deploy predates this tool, or the build never ran. ' +
                     'Push the build-stamp change, then run this again.';
  } else if (fetchError) {
    result.verdict = 'UNREACHABLE — could not read the stamp: ' + fetchError;
  } else if (!stamp || !stamp.commit) {
    result.verdict = 'NO STAMP — build-info.json exists but carries no commit.';
  } else {
    // COMPARE THE LIVE STAMP TO THE LOCAL STAMP FILE, NOT TO A COMMIT HASH.
    //
    // The first version compared stamp.commit === git HEAD, which can NEVER match: build.mjs
    // writes the stamp using HEAD at build time, and the commit that then contains the stamp
    // has a different hash by definition. It reported STALE on a perfect deploy — a false
    // alarm, which is how a real alarm gets ignored, restoring the exact blind spot this tool
    // was built to remove.
    //
    // The real question is "is the live site serving my current files?", and the honest test is
    // whether the deployed stamp equals the one on disk. Cloudflare serves docs/ statically, so
    // the stamp travels with the code: if the deploy landed, the file matches.
    // COMPARE AGAINST THE STAMP AS COMMITTED, NOT THE WORKING-TREE FILE.
    //
    // Second false alarm, same tool, 2026-07-28. The working-tree copy is NOT what deployed:
    // .githooks/pre-push runs `node build.mjs` on every push, which rewrites
    // docs/build-info.json with whatever HEAD is at that moment — AFTER the commit was made.
    // So the file on disk drifts ahead of the file that actually shipped, and comparing to it
    // reported STALE on a deploy that had landed perfectly. Verified the same day: the live
    // site was serving data-details x3 and the W-CART-1 marker while this said "2 commits
    // behind".
    //
    // Only git knows what was actually committed and therefore actually served, so ask git.
    // Fall back to the working-tree file only if git cannot answer.
    let localStamp = null;
    try {
      localStamp = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/build-info.json'], { encoding: 'utf8' }));
    } catch {
      try {
        localStamp = JSON.parse(readFileSync(new URL('../docs/build-info.json', import.meta.url), 'utf8'));
      } catch { /* no stamp anywhere - fall through to the commit comparison below */ }
    }

    if (localStamp && localStamp.commit) {
      result.localStampCommit = localStamp.shortCommit;
      if (localStamp.commit === stamp.commit) {
        result.verdict = 'DEPLOYED — the live site is serving your current build.';
      } else {
        const n = commitsBetween(stamp.commit, head);
        result.behindBy = n;
        result.verdict = 'STALE — the live site is serving an OLDER build' +
          (n !== null ? ` (${n} commit${n === 1 ? '' : 's'} behind)` : '') +
          '. Your latest push did NOT reach the site. Check the Cloudflare build.';
      }
    } else if (stamp.commit === head) {
      result.verdict = 'DEPLOYED — the live site is running your current commit.';
    } else {
      const n = commitsBetween(stamp.commit, head);
      result.behindBy = n;
      result.verdict = 'STALE — the live site is serving an OLDER build' +
        (n !== null ? ` (${n} commit${n === 1 ? '' : 's'} behind)` : '') +
        '. Your latest push did NOT reach the site. Check the Cloudflare build.';
    }
  }

  // builtBy=local means someone ran build.mjs on a laptop and committed the result, so the stamp
  // reflects THEIR machine, not a real Cloudflare build. Worth flagging or the check is theatre.
  if (stamp && stamp.builtBy === 'local' && result.verdict.startsWith('DEPLOYED')) {
    result.verdict += ' (NOTE: stamp says builtBy=local — committed from a workstation, not built by Cloudflare.)';
  }

  if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); }
  else {
    console.log('');
    console.log('  site        : ' + result.site);
    console.log('  local HEAD  : ' + (result.localShort || '?'));
    console.log('  live commit : ' + (result.liveShort || '(none)') +
                (result.liveBuiltAt ? '   built ' + result.liveBuiltAt : ''));
    if (result.liveBuiltBy) console.log('  built by    : ' + result.liveBuiltBy);
    console.log('');
    console.log('  ' + result.verdict);
    console.log('');
  }

  // Non-zero on anything that is not a confirmed match, so this can gate a script.
  process.exit(result.verdict.startsWith('DEPLOYED') ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
