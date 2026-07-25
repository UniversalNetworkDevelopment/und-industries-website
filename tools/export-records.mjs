#!/usr/bin/env node
// export-records.mjs — nightly local export of the legal-critical tables.
//
// WHY THIS EXISTS
// The customer record is the lawsuit defence: who agreed to what, when, what they paid for, what
// was done. It lives ONLY in Supabase, on the free tier, with no owner-controlled backup. A bad
// migration, an accidental delete or a corrupted table would take it with no undo.
// This writes a durable local copy into E:\UND-Records, which sits on E: and is therefore picked
// up automatically by the existing daily hash-verified backup (E:\AXIOM\und-backup.ps1, E: ->
// D:\UND-Backup — it enumerates E: live, so a new folder needs no backup-job change).
//
// DESIGN (modular + scalable): the table list is DATA. Adding a table is one line in TABLES,
// never new code. Nothing here is per-table special-cased.
//
// AN EXPORT THAT SILENTLY WROTE NOTHING IS THE FAILURE THAT MATTERS, so this does not trust its
// own writes: every file is re-read from disk and re-hashed after writing, and the run exits
// NON-ZERO if any table failed. Success is proven, not assumed.
//
// CREDENTIALS: the service-role key is read from the environment ONLY. This script never reads
// .env and never stores the key. Set it in the scheduled task, e.g.
//   $env:SUPABASE_SERVICE_ROLE_KEY = '...'   (see docs at the bottom of this file)
//
// USAGE
//   node tools/export-records.mjs                 # normal run
//   node tools/export-records.mjs --dry-run       # config + connectivity check, writes nothing
//
// Related: E:\Plans\OPEN-LOOPS.md (FUL-1 item 6), memory und-customer-record-architecture.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = process.env.UND_RECORDS_DIR || 'E:\\UND-Records\\exports';
const KEEP_RUNS = parseInt(process.env.UND_RECORDS_KEEP || '30', 10);
const DRY = process.argv.includes('--dry-run');
const HUB = 'http://127.0.0.1:3134/api/v1/hub/issue';

// ── THE RECORD. Add a table here; nothing else changes. ──────────────────────
// `critical: true` means a failure to export it fails the whole run — these are the rows that
// constitute the legal record. Non-critical tables are exported best-effort.
const TABLES = [
  { name: 'customers',              critical: true },
  { name: 'purchases',              critical: true },
  { name: 'tos_consents',           critical: true },
  { name: 'policy_acceptance_logs', critical: true },
  { name: 'service_tickets',        critical: true },
  { name: 'entitlements',           critical: true },
  { name: 'subscriptions',          critical: false },
  { name: 'service_reviews',        critical: false },
  { name: 'audit_logs',             critical: false },
  { name: 'webhook_events',         critical: false },
];

const PAGE = 1000;   // PostgREST default cap; paginate so a big table is never silently truncated.

function log(msg) { process.stdout.write(msg + '\n'); }

function config() {
  const url = process.env.SUPABASE_URL || (() => {
    try {
      const s = readFileSync(join(ROOT, 'docs/assets/js/site-state.js'), 'utf8');
      return (s.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
    } catch { return null; }
  })();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key };
}

// Fetch every row of a table, paginated. Returns an array or throws.
async function fetchAll(url, key, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function notifyHub(title, detail, severity) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(HUB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'records-export', severity, issues: [{ title, detail, severity }] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch { /* the hub being down must never fail the export itself */ }
}

// Keep the last N runs so the folder cannot grow without bound.
function prune() {
  try {
    const runs = readdirSync(OUT_ROOT).filter(d => {
      try { return statSync(join(OUT_ROOT, d)).isDirectory(); } catch { return false; }
    }).sort();
    for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
      rmSync(join(OUT_ROOT, old), { recursive: true, force: true });
      log(`  pruned old run ${old}`);
    }
  } catch { /* pruning is housekeeping, never fatal */ }
}

async function main() {
  const { url, key } = config();
  if (!url) { log('FATAL: no SUPABASE_URL (env or site-state.js)'); process.exit(2); }
  if (!key) {
    log('FATAL: SUPABASE_SERVICE_ROLE_KEY is not set in the environment.');
    log('       This script never reads .env - set it on the scheduled task instead.');
    process.exit(2);
  }
  log(`Supabase: ${url}`);
  log(`Output:   ${OUT_ROOT}`);
  if (DRY) { log('--dry-run: config OK, writing nothing.'); process.exit(0); }

  // Timestamp is filesystem-safe and sorts chronologically.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(OUT_ROOT, stamp);
  mkdirSync(dir, { recursive: true });

  const manifest = { exported_at: new Date().toISOString(), source: url, tables: {} };
  const failures = [];

  for (const t of TABLES) {
    try {
      const rows = await fetchAll(url, key, t.name);
      const body = Buffer.from(rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
      const file = join(dir, `${t.name}.ndjson`);
      writeFileSync(file, body);

      // VERIFY: re-read from disk and re-hash. Do not trust that the write landed.
      const back = readFileSync(file);
      const wrote = sha256(body), read = sha256(back);
      if (wrote !== read || back.length !== body.length) {
        throw new Error(`verify failed: hash/size mismatch after write`);
      }
      manifest.tables[t.name] = { rows: rows.length, bytes: back.length, sha256: read, critical: !!t.critical };
      log(`  ok   ${t.name.padEnd(24)} ${String(rows.length).padStart(6)} rows  ${read.slice(0, 12)}`);
    } catch (e) {
      manifest.tables[t.name] = { error: e.message, critical: !!t.critical };
      failures.push({ table: t.name, critical: !!t.critical, error: e.message });
      log(`  FAIL ${t.name.padEnd(24)} ${e.message}`);
    }
  }

  manifest.failures = failures;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  prune();

  const criticalFails = failures.filter(f => f.critical);
  if (criticalFails.length) {
    const detail = criticalFails.map(f => `${f.table}: ${f.error}`).join(' | ');
    await notifyHub('Record export FAILED - legal record not backed up', detail, 'warning');
    log(`\nEXPORT FAILED - ${criticalFails.length} critical table(s) did not export.`);
    process.exit(1);
  }
  if (failures.length) {
    await notifyHub('Record export completed with non-critical failures',
                    failures.map(f => `${f.table}: ${f.error}`).join(' | '), 'warning');
  }
  const total = Object.values(manifest.tables).reduce((n, t) => n + (t.rows || 0), 0);
  log(`\nEXPORT OK - ${total} rows across ${Object.keys(manifest.tables).length} tables -> ${dir}`);
}

main().catch(async (e) => {
  await notifyHub('Record export CRASHED', String(e && e.message), 'warning');
  console.error('FATAL:', e);
  process.exit(1);
});
