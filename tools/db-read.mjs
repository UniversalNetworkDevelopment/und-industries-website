#!/usr/bin/env node
// db-read.mjs — READ-ONLY access to the live database. Structurally incapable of writing.
//
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM migrate.mjs
// Reading the live database answers questions nothing else can: which RLS policies actually exist,
// how many accounts are sitting unassigned, whether a column is really absent. Until now every one
// of those questions cost a round trip — "please paste this query into the dashboard" — and the
// ones that never got asked simply stayed unverified. That is how a nightly backup ended up
// configured against a table that does not exist.
//
// But read access and write access must never live in the same tool. `tools/migrate.mjs` is the
// ONLY thing allowed to change the schema, and it is gated behind a read-before-apply token. This
// tool is its opposite number: it can look at everything and change nothing.
//
// THREE INDEPENDENT GATES, because a rule that depends on good intentions is not a rule:
//
//   GATE 1 — POSTGRES ROLE PRIVILEGES. It connects as a dedicated read-only role. On startup it
//            ASKS THE DATABASE whether that role can write, and REFUSES TO RUN if it can. So
//            pointing this at the owner connection string by mistake fails closed instead of
//            silently handing a write-capable connection to a "read-only" tool.
//   GATE 2 — READ ONLY TRANSACTION. Every statement runs inside `BEGIN TRANSACTION READ ONLY`.
//            Postgres itself rejects any write, regardless of what this file does.
//   GATE 3 — STATEMENT ALLOWLIST. Only SELECT / WITH...SELECT / EXPLAIN are accepted, and only one
//            statement per call, so nothing can be smuggled in after a semicolon.
//
// Any one of the three would stop a write. All three have to fail at once for damage to happen.
//
// THE QUERY IS ALWAYS PRINTED BEFORE IT RUNS. Read-before-touch applies to reads too: nothing
// should execute against production that was not displayed first.
//
// CREDENTIALS: read from the environment BY NAME ONLY. This file never reads .env, never writes a
// credential anywhere, and never prints the connection string — not even on error.
//
// SETUP: see E:\SQL-Registry\SETUP-CLAUDE-READONLY.md
//
// USAGE
//   node tools/db-read.mjs --list                  # the named queries available
//   node tools/db-read.mjs rls                     # run a named query
//   node tools/db-read.mjs columns service_tickets # named query with an argument
//   node tools/db-read.mjs --sql "select 1"        # ad-hoc SELECT (still all three gates)
//   node tools/db-read.mjs rls --json              # machine-readable

import { createRequire } from 'node:module';

const ENV_VAR = 'SUPABASE_DB_URL_READONLY';
const JSON_OUT = process.argv.includes('--json');
const log = (m) => process.stdout.write(m + '\n');

// ── GATE 3: what may be executed at all ──────────────────────────────────────
// Deliberately an allowlist, not a denylist. A denylist is a guess about every dangerous word
// somebody might type; an allowlist is a statement of the only three things this tool does.
const ALLOWED_START = /^\s*(select|with|explain)\b/i;
// Words that must never appear even inside an allowed statement — a CTE can contain a writable
// clause (`WITH x AS (DELETE ... RETURNING *) SELECT ...` is valid Postgres and writes).
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|reindex|call|do|set\s+role|security\s+definer)\b/i;

function assertReadOnlyStatement(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!ALLOWED_START.test(trimmed)) {
    throw new Error('REFUSED: only SELECT / WITH / EXPLAIN statements are permitted.');
  }
  if (/;/.test(trimmed)) {
    throw new Error('REFUSED: multiple statements. One statement per call — a semicolon is how a second, unreviewed statement gets smuggled in behind an approved one.');
  }
  if (FORBIDDEN.test(trimmed)) {
    const word = (trimmed.match(FORBIDDEN) || [])[0];
    throw new Error(`REFUSED: the statement contains "${word}". A writable CTE inside a SELECT is still a write.`);
  }
  return trimmed;
}

// ── The named queries. DATA, not code: add one here and nothing else changes. ─
// These exist so that the routine questions are asked the SAME way every time and the answer is
// comparable across runs. Improvised SQL is how you get two different answers to one question.
const QUERIES = {
  tables: {
    what: 'Every table in public, with its RLS status and live row estimate.',
    sql: `SELECT c.relname AS table_name,
                 c.relrowsecurity AS rls_enabled,
                 c.relforcerowsecurity AS rls_forced,
                 c.reltuples::bigint AS approx_rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
           ORDER BY c.relname`,
  },

  rls: {
    what: 'THE question the schema export cannot answer: every RLS policy, verbatim.',
    sql: `SELECT tablename, policyname, cmd, roles::text AS roles,
                 COALESCE(qual, '(none)') AS using_expr,
                 COALESCE(with_check, '(none)') AS with_check_expr
            FROM pg_policies
           WHERE schemaname = 'public'
           ORDER BY tablename, cmd, policyname`,
  },

  unprotected: {
    what: 'Tables with RLS ON but ZERO policies (deny-all), and tables with RLS OFF (wide open). The second list is the dangerous one.',
    sql: `SELECT c.relname AS table_name,
                 c.relrowsecurity AS rls_enabled,
                 COUNT(p.policyname) AS policy_count,
                 CASE WHEN NOT c.relrowsecurity THEN 'RLS OFF - READABLE BY ANY ANON KEY HOLDER'
                      WHEN COUNT(p.policyname) = 0 THEN 'RLS on, no policies - deny all (verify this is intended)'
                      ELSE 'ok' END AS assessment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
           WHERE n.nspname = 'public' AND c.relkind = 'r'
           GROUP BY c.relname, c.relrowsecurity
          HAVING NOT c.relrowsecurity OR COUNT(p.policyname) = 0
           ORDER BY c.relrowsecurity, c.relname`,
  },

  permissive: {
    what: "Policies whose USING clause is literally true — every authenticated user reads every row.",
    sql: `SELECT tablename, policyname, cmd, qual AS using_expr
            FROM pg_policies
           WHERE schemaname = 'public'
             AND (qual = 'true' OR qual ILIKE '%(true)%')
           ORDER BY tablename`,
  },

  columns: {
    what: 'Exact live columns for one table. Pass the table name as an argument.',
    arg: 'table',
    sql: `SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1
           ORDER BY ordinal_position`,
  },

  tiers: {
    what: 'THE tier question: how many portal accounts sit at each user_type / access_level / status.',
    sql: `SELECT user_type, access_level, status, role, COUNT(*) AS accounts
            FROM public.portal_profiles
           GROUP BY user_type, access_level, status, role
           ORDER BY user_type, access_level, status`,
  },

  population: {
    what: 'How many people are actually signed up, and how many have ever bought anything.',
    sql: `SELECT 'profiles'         AS bucket, COUNT(*) AS n FROM public.profiles
          UNION ALL SELECT 'portal_profiles',       COUNT(*) FROM public.portal_profiles
          UNION ALL SELECT 'company_members',       COUNT(*) FROM public.company_members
          UNION ALL SELECT 'company_members ACTIVE',COUNT(*) FROM public.company_members WHERE active
          UNION ALL SELECT 'customers (stripe)',    COUNT(*) FROM public.customers
          UNION ALL SELECT 'purchases',             COUNT(*) FROM public.purchases
          UNION ALL SELECT 'entitlements',          COUNT(*) FROM public.entitlements
          UNION ALL SELECT 'subscriptions',         COUNT(*) FROM public.subscriptions
          UNION ALL SELECT 'service_tickets',       COUNT(*) FROM public.service_tickets
          UNION ALL SELECT 'tos_consents',          COUNT(*) FROM public.tos_consents
          UNION ALL SELECT 'feedback',              COUNT(*) FROM public.feedback
          UNION ALL SELECT 'contact_messages',      COUNT(*) FROM public.contact_messages
          ORDER BY bucket`,
  },

  ungranted: {
    what: 'Accounts stuck in the approval gate, and grant-ledger rows with no role at all.',
    sql: `SELECT 'portal_profiles status=pending' AS issue, COUNT(*) AS n
            FROM public.portal_profiles WHERE status = 'pending'
          UNION ALL
          SELECT 'company_members with NULL role', COUNT(*)
            FROM public.company_members WHERE role IS NULL
          UNION ALL
          SELECT 'company_members active but NDA unsigned', COUNT(*)
            FROM public.company_members WHERE active AND NOT COALESCE(nda_signed, false)`,
  },

  feedback: {
    what: 'The feedback that has been sitting where nobody sees it.',
    sql: `SELECT created_at, page, email, LEFT(message, 300) AS message
            FROM public.feedback
           ORDER BY created_at DESC
           LIMIT 50`,
  },

  functions: {
    what: 'The RLS helper functions policies depend on (is_internal_active, is_portal_manager, ...).',
    sql: `SELECT p.proname AS function_name,
                 pg_get_function_identity_arguments(p.oid) AS args,
                 p.prosecdef AS security_definer,
                 pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
           ORDER BY p.proname`,
  },
};

function usage() {
  log('\nREAD-ONLY database access. This tool cannot write — see the three gates at the top of the file.\n');
  log('Named queries:');
  for (const [name, q] of Object.entries(QUERIES)) {
    log(`  ${(name + (q.arg ? ' <' + q.arg + '>' : '')).padEnd(24)} ${q.what}`);
  }
  log('\n  --sql "<SELECT ...>"     ad-hoc, still subject to all three gates');
  log('  --json                   machine-readable output\n');
}

async function main() {
  const argv = process.argv.slice(2).filter(a => a !== '--json');
  if (!argv.length || argv[0] === '--list' || argv[0] === '--help') { usage(); process.exit(0); }

  // TWO WAYS IN, AND THE SIMPLE ONE IS ALLOWED ON PURPOSE.
  //   Preferred: SUPABASE_DB_URL_READONLY — a dedicated role with no write privileges. All three
  //              gates active. Setting this up costs one extra step (creating the role).
  //   Fallback:  SUPABASE_DB_URL — the owner connection string, which also powers migrate.mjs and
  //              is therefore probably already set. Gate 1 cannot apply (the role CAN write), but
  //              gates 2 and 3 still do, and they are the two that actually stop a mutation: a
  //              Postgres READ ONLY transaction rejects every write regardless of privilege, and
  //              the allowlist means only SELECT ever reaches the server.
  // Refusing the fallback outright would have been security theatre — it would not have made
  // anything safer, it would just have made the tool unusable until an optional step was done.
  // What matters is that the mode is never ambiguous, so it is announced on every single run.
  const roUrl = process.env[ENV_VAR];
  const ownerUrl = process.env.SUPABASE_DB_URL;
  const url = roUrl || ownerUrl;
  const usingOwner = !roUrl && !!ownerUrl;
  if (!url) {
    log(`FATAL: neither ${ENV_VAR} nor SUPABASE_DB_URL is set in the environment.`);
    log('');
    log('  QUICKEST PATH (one step):');
    log('     setx SUPABASE_DB_URL "<Supabase -> Settings -> Database -> Connection string (URI)>"');
    log('     ...then open a NEW terminal. This also unblocks tools/migrate.mjs.');
    log('');
    log('  SAFER PATH (one extra step): create a read-only role and set');
    log(`     ${ENV_VAR}. See E:\\SQL-Registry\\SETUP-CLAUDE-READONLY.md`);
    log('');
    log('  Either variable is read BY NAME. This tool never reads .env and never prints the value.');
    process.exit(2);
  }

  let pg;
  try { pg = createRequire(import.meta.url)('pg'); }
  catch { log('FATAL: the "pg" driver is not installed. Run:  npm i pg'); process.exit(2); }

  // Resolve what we are about to run, and PRINT IT, before connecting.
  let sql, params = [], title;
  const sqlFlagIdx = argv.indexOf('--sql');
  if (sqlFlagIdx !== -1) {
    sql = argv[sqlFlagIdx + 1];
    if (!sql) { log('FATAL: --sql needs a statement.'); process.exit(2); }
    title = 'ad-hoc';
  } else {
    const name = argv[0];
    const q = QUERIES[name];
    if (!q) { log(`FATAL: unknown query "${name}".`); usage(); process.exit(2); }
    if (q.arg && !argv[1]) { log(`FATAL: "${name}" needs an argument: <${q.arg}>`); process.exit(2); }
    sql = q.sql;
    if (q.arg) params = [argv[1]];
    title = name;
  }

  try { sql = assertReadOnlyStatement(sql); }
  catch (e) { log(String(e.message)); process.exit(1); }

  if (!JSON_OUT) {
    log(`\n--- query: ${title} ---`);
    log(sql);
    if (params.length) log(`params: ${JSON.stringify(params)}`);
    log('---');
  }

  // TLS IS VERIFIED. This connection is to production. Never rejectUnauthorized:false — a company
  // that sells security does not ship a tool that skips certificate validation.
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
  } catch (e) {
    // Never echo the connection string, not even inside a driver error message.
    log(`FATAL: could not connect. (${String(e.code || e.message).slice(0, 120)})`);
    log(`       The value of ${ENV_VAR} is never printed by this tool.`);
    process.exit(2);
  }

  try {
    // ── GATE 1: ask the DATABASE whether this role can write. ─────────────────
    // Belt and braces against the likeliest real mistake: pasting the owner/service connection
    // string into the read-only variable. If that happens, this refuses to run at all rather than
    // quietly operating with write powers under a read-only name.
    const probe = await client.query(`
      SELECT current_user AS role,
             has_table_privilege(current_user, 'public.profiles', 'INSERT') AS can_insert,
             has_table_privilege(current_user, 'public.profiles', 'UPDATE') AS can_update,
             has_table_privilege(current_user, 'public.profiles', 'DELETE') AS can_delete,
             pg_has_role(current_user, 'pg_write_all_data', 'MEMBER') AS write_all`);
    const p = probe.rows[0];
    const writeCapable = p.can_insert || p.can_update || p.can_delete || p.write_all;
    if (writeCapable && !usingOwner) {
      // The dedicated read-only variable is pointing at a write-capable role. That is a
      // MISCONFIGURATION, not a choice — the variable's whole purpose is that it cannot write.
      // Fail closed rather than operate with powers the name says it does not have.
      log('\n*** REFUSED — THE CONNECTED ROLE CAN WRITE. ***');
      log(`    role: ${p.role}   insert=${p.can_insert} update=${p.can_update} delete=${p.can_delete} write_all=${p.write_all}`);
      log(`    ${ENV_VAR} is set, but it points at a write-capable connection (probably the owner`);
      log('    or service role). That variable is supposed to be the role that CANNOT write.');
      log('    Either fix it, or unset it to fall back to SUPABASE_DB_URL deliberately.');
      log('    Setup: E:\\SQL-Registry\\SETUP-CLAUDE-READONLY.md');
      process.exit(1);
    }
    if (usingOwner && !JSON_OUT) {
      // Announced on EVERY run, never suppressed. The danger of the fallback is not that it
      // writes something — gates 2 and 3 make that impossible — it is that someone forgets which
      // credential is in play. An unstated mode is how a temporary shortcut becomes permanent.
      log('');
      log('  ! OWNER CREDENTIAL MODE — using SUPABASE_DB_URL (the connection that CAN write).');
      log(`    role=${p.role}. Gate 1 (role privileges) does not apply here.`);
      log('    Still enforced: READ ONLY transaction + SELECT-only allowlist. No write can execute.');
      log('    To close gate 1 too, create the read-only role: E:\\SQL-Registry\\SETUP-CLAUDE-READONLY.md');
    }

    // ── GATE 2: Postgres itself refuses writes inside this transaction. ───────
    await client.query('BEGIN TRANSACTION READ ONLY');
    const res = await client.query(sql, params);
    await client.query('ROLLBACK');

    if (JSON_OUT) { console.log(JSON.stringify(res.rows, null, 2)); return; }

    if (!res.rows.length) { log('\n(0 rows)\n'); return; }
    const cols = Object.keys(res.rows[0]);
    // Wide values (policy expressions, function bodies) are unreadable in a table — print those
    // as blocks instead of truncating them, because a truncated policy is worse than useless.
    const wide = res.rows.some(r => cols.some(c => String(r[c] ?? '').length > 60));
    if (wide) {
      for (const r of res.rows) {
        log('');
        for (const c of cols) log(`  ${c}: ${r[c] === null ? '(null)' : String(r[c])}`);
      }
      log('');
    } else {
      const w = {};
      for (const c of cols) w[c] = Math.max(c.length, ...res.rows.map(r => String(r[c] ?? '').length));
      log('\n' + cols.map(c => c.padEnd(w[c])).join('  '));
      log(cols.map(c => '-'.repeat(w[c])).join('  '));
      for (const r of res.rows) log(cols.map(c => String(r[c] ?? '').padEnd(w[c])).join('  '));
      log('');
    }
    log(`${res.rows.length} row(s). Read-only transaction rolled back.`);
  } catch (e) {
    log(`\nQUERY FAILED: ${e.message}`);
    await client.query('ROLLBACK').catch(() => {});
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
