#!/usr/bin/env node
// migrate.mjs — the ONLY sanctioned way to change the database schema.
//
// WHY THIS EXISTS
// Schema changes had no gate, no record, and no verification. SQL was pasted into the Supabase
// editor by hand, and nothing anywhere recorded that it ran. That is exactly how
// supabase/migrations/20260615_system_logs.sql sat unapplied for six weeks while EVERY audit
// write failed silently — the file existed, so everyone assumed the table did. "The SQL is
// checked in" and "the column exists in production" were unrelated claims.
//
// This does for the database what the pre-push hook does for code: a real gate, an auditable
// record, and a refusal when something is dangerous.
//
// THE RULES (deliberately strict — this runs against PRODUCTION customer data):
//   1. FILES ONLY. It executes .sql files from db_schema/. It cannot run ad-hoc SQL, so a
//      mistaken idea can never be improvised straight into production.
//   2. ADDITIVE-ONLY BY DEFAULT. Anything that can destroy data or remove protection is
//      REFUSED and reported — it never runs unattended. See DESTRUCTIVE below.
//   3. EVERY RUN IS RECORDED in public.schema_migrations (filename, sha256, applied_at), so
//      "is it applied?" is a query, never a guess.
//   4. ALREADY-APPLIED FILES ARE SKIPPED, and if a file's checksum CHANGED since it was
//      applied it stops and says so — silent drift between the repo and the database is the
//      failure this whole tool exists to prevent.
//   5. DRY-RUN IS THE DEFAULT. Nothing executes without --apply.
//   6. THE CREDENTIAL IS NEVER READ OR PRINTED. It comes from the environment by name only.
//
// USAGE
//   node tools/migrate.mjs                 # dry run: what WOULD run, and what is refused
//   node tools/migrate.mjs --apply         # apply pending additive migrations
//   node tools/migrate.mjs --status        # what is applied vs pending
//   node tools/migrate.mjs --apply --allow-destructive --i-understand
//                                          # the escape hatch: BOTH flags, and it names every
//                                          # dangerous statement before running it
//
// REQUIRES
//   env SUPABASE_DB_URL  — Supabase -> Settings -> Database -> Connection string (URI).
//                          Set it as a Windows environment variable. Never paste it in chat,
//                          never commit it. This script reads it by name and never prints it.
//   npm i pg             — the postgres driver (one-time).

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'db_schema');
const APPLY = process.argv.includes('--apply');
const STATUS = process.argv.includes('--status');
const ALLOW_DESTRUCTIVE = process.argv.includes('--allow-destructive') && process.argv.includes('--i-understand');

// ── What counts as dangerous ────────────────────────────────────────────────
// Each entry is [label, regex]. A migration matching ANY of these is refused unless BOTH
// escape-hatch flags are passed. The list is deliberately blunt: a false refusal costs a
// conversation, a false approval can cost the customer record or expose every customer's data.
const DESTRUCTIVE = [
  ['DROP TABLE',        /\bdrop\s+table\b/i],
  ['DROP SCHEMA',       /\bdrop\s+schema\b/i],
  ['DROP DATABASE',     /\bdrop\s+database\b/i],
  ['DROP COLUMN',       /\balter\s+table[\s\S]{0,200}?\bdrop\s+column\b/i],
  ['TRUNCATE',          /\btruncate\b/i],
  ['DELETE FROM',       /\bdelete\s+from\b/i],
  ['UPDATE (data)',     /\bupdate\s+(?:public\.)?[a-z_]+\s+set\b/i],
  // The two that would silently expose every customer's data. RLS is the ONLY thing standing
  // between the public anon key and the purchases/customers/tos_consents tables.
  ['DISABLE ROW LEVEL SECURITY', /\bdisable\s+row\s+level\s+security\b/i],
  ['DROP POLICY',       /\bdrop\s+policy\b/i],
  ['ALTER OWNER',       /\balter\s+[a-z]+\s+[\s\S]{0,80}?\bowner\s+to\b/i],
];

function scan(sql) {
  return DESTRUCTIVE.filter(([, re]) => re.test(sql)).map(([label]) => label);
}
const sha = (s) => createHash('sha256').update(s).digest('hex');
const log = (m) => process.stdout.write(m + '\n');

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    log('FATAL: SUPABASE_DB_URL is not set in the environment.');
    log('       Supabase -> Settings -> Database -> Connection string (URI).');
    log('       Set it as an environment variable. This script never reads .env and never prints it.');
    process.exit(2);
  }

  let pg;
  try { pg = (await import('pg')).default; }
  catch { log('FATAL: the "pg" driver is not installed. Run:  npm i pg'); process.exit(2); }

  const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) { log('No .sql files in db_schema/'); process.exit(0); }

  // TLS IS VERIFIED. Never `rejectUnauthorized: false` here: this connection carries the
  // service-role credential and every customer record, so disabling certificate verification
  // would allow a man-in-the-middle to read and alter both. Supabase serves a publicly-trusted
  // certificate, so strict verification just works. If it ever fails, the answer is to add the
  // proper CA to the trust store - never to switch the check off. A company that sells security
  // does not ship a tool that skips certificate validation.
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    // The record of what has actually run. Created here because a ledger that must itself be
    // installed by hand is the same trap all over again.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename    text PRIMARY KEY,
        sha256      text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT filename, sha256, applied_at FROM public.schema_migrations');
    const applied = new Map(rows.map(r => [r.filename, r]));

    const pending = [], refused = [], drifted = [];
    for (const f of files) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      const h = sha(sql);
      const prev = applied.get(f);
      if (prev) {
        if (prev.sha256 !== h) drifted.push({ f, appliedAt: prev.applied_at });
        continue;
      }
      const danger = scan(sql);
      (danger.length && !ALLOW_DESTRUCTIVE ? refused : pending).push({ f, sql, danger });
    }

    log(`\nMigrations in db_schema/: ${files.length}   applied: ${applied.size}   pending: ${pending.length}   refused: ${refused.length}`);

    if (drifted.length) {
      log('\n*** CHECKSUM DRIFT - these files CHANGED after they were applied:');
      for (const d of drifted) log(`    ${d.f}   (applied ${new Date(d.appliedAt).toISOString()})`);
      log('    The repo and the database now disagree. Write a NEW migration; never edit an applied one.');
    }
    if (refused.length) {
      log('\n*** REFUSED - destructive statements, not run:');
      for (const r of refused) log(`    ${r.f}  ->  ${r.danger.join(', ')}`);
      log('    Review by hand. To run anyway: --apply --allow-destructive --i-understand');
    }
    if (STATUS || !pending.length) {
      if (!pending.length) log('\nNothing pending.');
      for (const [f, r] of applied) log(`  applied  ${f}  ${new Date(r.applied_at).toISOString()}`);
      return;
    }

    log('\nPending:');
    for (const p of pending) log(`    ${p.f}  sha=${sha(p.sql).slice(0, 12)}${p.danger.length ? '   [DESTRUCTIVE: ' + p.danger.join(', ') + ']' : ''}`);

    // ── READ BEFORE YOU TOUCH - ENFORCED, NOT ADVISED ──────────────────────
    // Applying SQL is the most consequential mutation in this whole system, and it was the one
    // thing that could slip past every existing guard: enforce-read-first.ps1 denies Edit/Write
    // on a file nobody read, but `node tools/migrate.mjs --apply` is a Bash call, so the runner
    // could have executed a migration NOBODY had opened. The rule is not a suggestion, so it
    // cannot rely on good intentions - it has to be a gate.
    //
    // So --apply alone is refused. You must pass --confirm=<token>, where the token is printed
    // ONLY by the dry run and is derived from the exact bytes of every pending file. Change a
    // file, or add one, and the token changes and the apply refuses. There is no way to reach
    // execution without having first seen the dry run for these exact contents.
    const token = sha(pending.map(p => p.f + ':' + sha(p.sql)).join('|')).slice(0, 16);

    if (!APPLY) {
      log('\n--- SQL to be executed (read it) ---');
      for (const p of pending) {
        log(`\n===== ${p.f} =====`);
        log(p.sql.trim());
      }
      log(`\nDRY RUN - nothing executed.`);
      log(`To apply THESE EXACT files:\n    node tools/migrate.mjs --apply --confirm=${token}`);
      return;
    }

    const given = (process.argv.find(a => a.startsWith('--confirm=')) || '').split('=')[1];
    if (given !== token) {
      log('\nREFUSED: --apply requires --confirm=<token> from a dry run of these exact files.');
      log(given ? `  token given:    ${given}` : '  no --confirm given');
      log(`  token expected: ${token}`);
      log('  The pending files changed since your dry run, or you have not run one.');
      log('  Run `node tools/migrate.mjs` first, READ the SQL it prints, then apply.');
      process.exit(1);
    }

    for (const p of pending) {
      // Each migration is its own transaction: one failure rolls itself back and stops the run,
      // so a half-applied file can never be recorded as applied.
      log(`\napplying ${p.f} ...`);
      try {
        await client.query('BEGIN');
        await client.query(p.sql);
        await client.query(
          'INSERT INTO public.schema_migrations (filename, sha256) VALUES ($1,$2) ON CONFLICT (filename) DO NOTHING',
          [p.f, sha(p.sql)]
        );
        await client.query('COMMIT');
        log(`  OK  ${p.f}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        log(`  FAILED ${p.f}: ${e.message}`);
        log('  Rolled back. Stopping - later migrations may depend on this one.');
        process.exit(1);
      }
    }
    log('\nAll pending migrations applied and recorded.');
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
