-- FIX-RLS-TICKET-FORGERY.sql
-- Run in: Supabase -> SQL Editor. Read the whole file first. 2026-07-28.
--
-- ============================================================================
-- WHAT IS WRONG RIGHT NOW
-- ============================================================================
-- RLS is ON for every table involved, and `system_logs` is correctly locked
-- (RLS enabled with ZERO policies = default deny; nothing anonymous can write
-- to it). But two policies on `service_tickets` check WHO is acting and never
-- check WHAT they are writing.
--
-- 1) INSERT policy "authenticated users must sign tos to insert"
--    WITH CHECK: EXISTS (SELECT 1 FROM tos_consents WHERE user_id = auth.uid())
--
--    That is the ONLY condition. It does not pin user_id, status, or
--    amount_cents. So any signed-in user who has ever created a consent row can
--    insert a ticket with status = 'paid', amount_cents = 0, and even a
--    user_id belonging to somebody else.
--
--    The consent requirement is also decorative: the tos_consents INSERT policy
--    lets a user create their own consent rows freely, so the gate is satisfied
--    by inserting one junk row first.
--
-- 2) UPDATE policy "client submit intake"
--    USING:      user_id = auth.uid() AND intake_status = 'awaiting_intake'
--    WITH CHECK: user_id = auth.uid()
--
--    Again only identity. Nothing restricts WHICH COLUMNS may change, so a user
--    can UPDATE their own ticket and set status = 'paid' or amount_cents = 0.
--
-- ============================================================================
-- WHY THIS IS WORSE THAN EITHER BUG ALONE — THE TWO DEFECTS COMPOSE
-- ============================================================================
-- Tickets are written BEFORE the Stripe session exists (services.js), at
-- status = 'checkout_started', intake_status = 'awaiting_intake'. That is
-- EXACTLY the state the UPDATE policy above allows the owner of the row to
-- modify.
--
-- So the whole path is: add to cart -> a real ticket row is created -> abandon
-- Stripe, pay nothing -> UPDATE your own ticket to status = 'paid' -> it enters
-- fulfilment as a paid job. Free services, no card, no exploit tooling, just
-- the public anon key and a logged-in account.
--
-- Neither policy is wrong about identity. Both are missing the second half of
-- the question: not "who are you" but "what are you allowed to write".
--
-- ============================================================================
-- BEFORE YOU RUN IT — the one thing that could break
-- ============================================================================
-- Section 2 replaces table-wide UPDATE with column-level UPDATE. The four
-- columns granted are exactly the ones the client actually writes, read from
-- docs/assets/js/service-intake.js:451-456:
--     order_details, access_method, access_confirmed, intake_status
--
-- If the OWNER account edits tickets from the BROWSER (not through a Cloudflare
-- Function), those edits will start failing, because service_role bypasses RLS
-- and column grants but a browser session does not. Owner edits should go
-- server-side. Section 4 tells you how to check before you commit to this.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — INSERT: pin the identity AND the values (fixes F-1)
-- ============================================================================
DROP POLICY IF EXISTS "authenticated users must sign tos to insert" ON public.service_tickets;

CREATE POLICY "insert own unpaid ticket only"
  ON public.service_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- You may only create a ticket for YOURSELF.
    user_id = auth.uid()

    -- A new ticket is always unpaid and awaiting intake. 'paid' is a state only
    -- the Stripe webhook may set, and it runs as service_role, which bypasses
    -- this policy. So a browser can never mint a paid ticket.
    AND status = 'checkout_started'
    AND intake_status = 'awaiting_intake'

    -- A ticket cannot arrive already carrying a payment reference.
    AND stripe_session_id IS NULL

    -- The recorded amount must equal the published price for that slug. This is
    -- the seen-price == charged-price invariant, enforced at the database layer
    -- instead of only in the edge function.
    AND amount_cents = (
      SELECT sp.price_cents FROM public.store_products sp
      WHERE sp.slug = service_slug
    )

    -- Keep the consent requirement. It is weak on its own (see F-4 below) but
    -- it is not harmful, and removing it would lose the audit trail.
    AND EXISTS (
      SELECT 1 FROM public.tos_consents c WHERE c.user_id = auth.uid()
    )
  );


-- ============================================================================
-- SECTION 2 — UPDATE: restrict WHICH COLUMNS, not just who (fixes F-2)
-- ============================================================================
-- Postgres RLS cannot restrict columns, and WITH CHECK cannot compare against
-- the OLD row, so pinning `status` to a literal here is not possible: a
-- legitimately PAID customer submitting intake still has intake_status =
-- 'awaiting_intake', and would be blocked by any literal status check.
--
-- Column-level privileges are the correct mechanism for exactly this.
REVOKE UPDATE ON public.service_tickets FROM authenticated;
REVOKE UPDATE ON public.service_tickets FROM anon;

GRANT UPDATE (order_details, access_method, access_confirmed, intake_status)
  ON public.service_tickets TO authenticated;

-- The RLS policy still applies on top of the column grant. Both must pass.
-- Left as-is deliberately: its identity conditions are correct, and it is now
-- backed by a grant that makes status and amount_cents unwritable from a browser.


-- ============================================================================
-- SECTION 3 — VERIFY IT WORKED. Do not skip this.
-- ============================================================================
-- 3a. The new INSERT policy is in place and the old one is gone.
SELECT policyname, cmd, roles::text, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'service_tickets'
ORDER BY cmd, policyname;
-- EXPECT: "insert own unpaid ticket only" present.
--         "authenticated users must sign tos to insert" ABSENT.

-- 3b. `authenticated` can write ONLY those four columns.
SELECT column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'service_tickets'
  AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
ORDER BY column_name;
-- EXPECT EXACTLY 4 ROWS: access_confirmed, access_method, intake_status, order_details.
-- If `status` or `amount_cents` appears here, SECTION 2 DID NOT TAKE. Stop and say so.

-- 3c. Nothing already in the table was forged before this fix.
SELECT ticket_number, user_id, status, amount_cents, stripe_session_id, created_at
FROM public.service_tickets
WHERE status = 'paid' AND stripe_session_id IS NULL
ORDER BY created_at DESC;
-- EXPECT: ZERO ROWS. A ticket marked paid with no Stripe session was never paid
-- for. Any row here needs looking at before it is fulfilled.


-- ############################################################################
-- ##                                                                        ##
-- ##   STOP. THE FIX ENDS AT SECTION 3. DO NOT RUN WHAT IS BELOW.           ##
-- ##                                                                        ##
-- ##   What follows is an EMERGENCY UNDO, not the next step. Running it      ##
-- ##   REOPENS the hole: it restores table-wide UPDATE to `authenticated`    ##
-- ##   and puts the loose INSERT policy back.                                ##
-- ##                                                                        ##
-- ##   This happened for real on 2026-07-28. The fix was applied correctly,  ##
-- ##   verified correctly, and then undone within the minute, because the    ##
-- ##   undo was presented as a numbered step in the same sequence and a      ##
-- ##   numbered list reads as an instruction to continue. That was a         ##
-- ##   labelling failure, not a user error.                                  ##
-- ##                                                                        ##
-- ##   Run this ONLY if live checkout or intake has actually broken and you  ##
-- ##   need the store selling while it is diagnosed. Never "just in case".   ##
-- ##                                                                        ##
-- ##   AFTER RUNNING IT THE FORGERY PATH IS LIVE AGAIN: create a ticket via  ##
-- ##   the cart, abandon Stripe, UPDATE your own row to status='paid'.       ##
-- ##   Re-apply sections 1 and 2 as soon as the breakage is understood.      ##
-- ##                                                                        ##
-- ############################################################################
--
-- EMERGENCY UNDO (deliberately left commented out — uncomment to use):
--
-- GRANT UPDATE ON public.service_tickets TO authenticated;
-- DROP POLICY IF EXISTS "insert own unpaid ticket only" ON public.service_tickets;
-- CREATE POLICY "authenticated users must sign tos to insert"
--   ON public.service_tickets FOR INSERT TO authenticated
--   WITH CHECK (EXISTS (SELECT 1 FROM tos_consents WHERE tos_consents.user_id = auth.uid()));


-- ============================================================================
-- STILL OPEN AFTER THIS FILE — NOT FIXED HERE
-- ============================================================================
-- F-4, CONSENT FORGEABILITY. tos_consents rows are authored entirely by the
-- customer's own browser: the doc, version, itemised amounts, the acknowledgement
-- flags, the user_agent, and the `ip`. The INSERT policy only pins user_id, so
-- every other field is whatever the client sent.
--
-- That matters because these records exist to be evidence. In a chargeback or a
-- dispute, a consent record whose IP address was filled in by the disputing
-- party's own browser is weak, and the weakness is not obvious from looking at
-- the row. The real fix is to record consent SERVER-SIDE in a Cloudflare
-- Function, where the IP comes from the CF-Connecting-IP header and the amounts
-- are resolved from store_products rather than accepted from the page.
--
-- That is a code change, not a policy change, so it is not in this file.
-- Worth having reviewed by someone with legal training before relying on these
-- records in a real dispute.
