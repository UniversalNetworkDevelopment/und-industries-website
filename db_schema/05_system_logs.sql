-- 05_system_logs.sql
-- The security/audit event log that functions/util/supabase.js logEvent() writes to.
--
-- WHY THIS FILE EXISTS (found 2026-07-25)
-- logEvent() has always POSTed to `system_logs`, and that table WAS NEVER CREATED. Probed live:
--     GET /rest/v1/system_logs
--     -> PGRST205 "Could not find the table 'public.system_logs' in the schema cache"
-- and logEvent swallows its own failure (supabase.js:180-182 catches and only console.errors), so
-- every audit write has failed SILENTLY since the day it was written. Nothing was ever recorded.
--
-- That is not a cosmetic gap. These are the events it was supposed to capture:
--   stripe_orphan_payment          - money taken that could not be matched to an order
--   delivery_refused_agent         - an AI tried to tell a customer their work was done
--   delivery_proof_write_failed    - proof of delivery did not persist
--   job_complete_email_failed      - the customer was never told
--   admin_job_bad_agent_key        - someone used a wrong service key
-- i.e. exactly the trail you would need in a dispute, a chargeback, or a security incident.
--
-- WHY NOT REUSE audit_logs: it exists but is a DIFFERENT table for a different job
-- (DATABASE_SCHEMA.sql:96 - ticket_id/process_id/target_system, both NOT NULL, no severity/ip/
-- detail). Writing logEvent's payload into it would fail on the NOT NULL columns. Two different
-- concerns, two tables.
--
-- SAFETY: additive only. No DROP, no data loss. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.system_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- nullable on purpose: many events happen before/without a signed-in user
  -- (a bad agent key, an orphan payment with no resolvable account).
  user_id            uuid,
  action             text NOT NULL,
  severity           text NOT NULL DEFAULT 'info',
  ip                 text,
  device_fingerprint text,
  detail             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- 'critical' MUST be here. The first version of this file omitted it, and three call sites
  -- send it - create-checkout-session.js:174 (checkout_session_failed), stripe-webhook.js:300
  -- (owner_sale_email_failed) and create-paypal-order.js:127. Postgres rejected those rows and
  -- logEvent swallowed the rejection, so the alarm for "a customer paid and Alex was never told"
  -- was destroyed on write by the very table built to record it. Write the constraint to match
  -- what the code ACTUALLY sends, not what looked tidy: grep the call sites before constraining.
  CONSTRAINT system_logs_severity_chk CHECK (severity IN ('info','warning','error','critical','security','danger'))
);

-- For a database that already has the old constraint, widening it is safe and instant:
--   ALTER TABLE public.system_logs DROP CONSTRAINT IF EXISTS system_logs_severity_chk;
--   ALTER TABLE public.system_logs ADD CONSTRAINT system_logs_severity_chk
--     CHECK (severity IN ('info','warning','error','critical','security','danger'));

-- Queried by time (what happened lately), by action (find every orphan payment), and by user
-- (everything that ever happened to this account - the record architecture is per-account).
CREATE INDEX IF NOT EXISTS system_logs_created_idx  ON public.system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_action_idx   ON public.system_logs (action);
CREATE INDEX IF NOT EXISTS system_logs_user_idx     ON public.system_logs (user_id);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- NO policies, deliberately - same posture as service_reviews. With RLS on and no policy, anon
-- and authenticated can do NOTHING. Only the service_role key (server-side, in the Worker) and
-- the Supabase dashboard can read or write. A security log a customer could read, or worse
-- write, would be evidence you cannot rely on.

COMMENT ON TABLE public.system_logs IS
  'Security/audit events from the Cloudflare Workers (logEvent). Service-role writes only. Never client-readable.';

-- ── USEFUL QUERIES ──────────────────────────────────────────────────────────
-- Money that arrived but could not be fulfilled (check this after ANY sale):
--   SELECT created_at, detail FROM system_logs WHERE action = 'stripe_orphan_payment' ORDER BY created_at DESC;
--
-- Anything an AI was stopped from doing to a customer:
--   SELECT created_at, detail FROM system_logs WHERE action = 'delivery_refused_agent' ORDER BY created_at DESC;
--
-- Everything that ever happened to one account (per-account record):
--   SELECT created_at, action, severity, detail FROM system_logs WHERE user_id = '<uuid>' ORDER BY created_at DESC;
--
-- Recent problems only:
--   SELECT created_at, action, detail FROM system_logs WHERE severity IN ('error','security','danger')
--   ORDER BY created_at DESC LIMIT 50;
