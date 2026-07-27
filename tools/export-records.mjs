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
// VERIFIED AGAINST THE LIVE DATABASE 2026-07-26. The first version of this list was written
// from the repo's .sql files and included `policy_acceptance_logs` as CRITICAL — that table does
// not exist in the live project. The nightly backup would have failed on a critical table every
// single night, forever, alerting about a problem that was actually a typo in this list. A backup
// configured against a schema nobody checked is not a backup. Ground truth:
// E:\SQL-Registry\LIVE-SCHEMA-2026-07-26.sql
const TABLES = [
  // ── the legal record: who agreed to what, what they paid, what was done for them ──
  { name: 'customers',                 critical: true },
  { name: 'purchases',                 critical: true },
  { name: 'entitlements',              critical: true },
  { name: 'tos_consents',              critical: true },
  { name: 'legal_signatures',          critical: true },
  { name: 'service_tickets',           critical: true },
  { name: 'product_usage_proof',       critical: true },   // proof of delivery, insert-only
  // ── money ──
  { name: 'ledger',                    critical: true },
  { name: 'processed_financial_events',critical: true },
  { name: 'subscriptions',             critical: false },
  // ── the security/audit trail ──
  { name: 'system_logs',               critical: true },
  { name: 'data_access_log',           critical: false },
  { name: 'audit_logs',                critical: false },
  { name: 'webhook_events',            critical: false },
  // ── customer voice + support history ──
  { name: 'service_reviews',           critical: false },
  { name: 'feedback',                  critical: false },
  { name: 'contact_messages',          critical: false },
  { name: 'support_tickets',           critical: false },
  { name: 'cs_messages',               critical: false },
  { name: 'referral_redemptions',      critical: false },
  // ── catalog: rebuildable in principle, but 13 live tables have NO sql file, so keep it ──
  { name: 'store_products',            critical: false },
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

  // A MISSING TABLE IS A CONFIG ERROR, NOT AN EXPORT FAILURE - and the two must never look
  // alike. PostgREST answers PGRST205 ("could not find the table") for a table that does not
  // exist, versus a real error for one that does. Treating "I was told to back up something
  // that isn't there" as "the backup failed" is how a permanently broken job hides behind a
  // plausible alarm: you would see a nightly failure and assume the database was unreachable.
  // Name it precisely instead, and keep exporting everything that DOES exist.
  const missing = [];

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
      const msg = String(e && e.message || e);
      // PGRST205 / "could not find the table" = the table does not exist. That is a mistake in
      // TABLES above, not a backup failure, and it must be reported as its own category.
      if (/PGRST205|could not find the table/i.test(msg)) {
        manifest.tables[t.name] = { missing: true, critical: !!t.critical };
        missing.push({ table: t.name, critical: !!t.critical });
        log(`  MISSING ${t.name.padEnd(21)} table does not exist in this database`);
      } else {
        manifest.tables[t.name] = { error: msg, critical: !!t.critical };
        failures.push({ table: t.name, critical: !!t.critical, error: msg });
        log(`  FAIL ${t.name.padEnd(24)} ${msg}`);
      }
    }
  }
  manifest.missing = missing;

  manifest.failures = failures;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  prune();

  // A table configured here that does not exist is MY mistake, reported as its own thing so it
  // can never be mistaken for "the database was unreachable". Loud, but it does not fail the run
  // when the table is optional - the rest of the backup is still valid and still worth having.
  if (missing.length) {
    log(`\nCONFIG: ${missing.length} configured table(s) do not exist: ${missing.map(m => m.table).join(', ')}`);
    log('  Fix the TABLES list in this file. Ground truth: E:\\SQL-Registry\\LIVE-SCHEMA-<date>.sql');
    const criticalMissing = missing.filter(m => m.critical);
    if (criticalMissing.length) {
      await notifyHub('Record export MISCONFIGURED - a CRITICAL table does not exist',
        `Configured but absent: ${criticalMissing.map(m => m.table).join(', ')}. ` +
        `Either the table was never created, or this list is wrong. The legal record is NOT fully backed up.`,
        'warning');
      log(`EXPORT INCOMPLETE - ${criticalMissing.length} CRITICAL table(s) are configured but do not exist.`);
      process.exit(1);
    }
    await notifyHub('Record export: configured tables missing',
      `Absent (non-critical): ${missing.map(m => m.table).join(', ')}`, 'warning');
  }

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
  const exported = Object.values(manifest.tables).filter(t => !t.missing && !t.error).length;
  const total = Object.values(manifest.tables).reduce((n, t) => n + (t.rows || 0), 0);
  log(`\nEXPORT OK - ${total} rows across ${exported} tables -> ${dir}`);
}

main().catch(async (e) => {
  await notifyHub('Record export CRASHED', String(e && e.message), 'warning');
  console.error('FATAL:', e);
  process.exit(1);
});
