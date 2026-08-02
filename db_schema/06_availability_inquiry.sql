-- 06_availability_inquiry.sql
-- Adds 'inquiry' to store_products.availability.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
-- The store sells services self-serve. It has taken ZERO orders: 25 tickets, all
-- status='checkout_started', 0 paid, purchases and webhook_events both empty. The money chain has
-- never once run end to end, and the AI systems meant to fulfil the work can stage a job but are
-- not yet trusted to complete one.
--
-- Meanwhile the fulfilment chain is ALREADY human-approval-only and says so in code:
--   functions/api/admin-job.js  "An AGENT may not deliver. Only a signed-in human may tell a
--                                customer their work is done."
--   E:\Qwep\ticket-relay.js     escalates to the owner on a policy refusal instead of proceeding
--   E:\UND-Nexus\routes\orders.js  same, since 2026-08-02
--
-- So the back end already requires a human. Only the FRONT DOOR pretended otherwise. 'inquiry'
-- makes the storefront tell the truth about how this business actually runs today: the customer
-- asks, the owner quotes, and money changes hands only after a human has agreed to do the work.
--
-- ── WHY THIS FILE HAS TO EXIST AT ALL ────────────────────────────────────────
-- The front end for this shipped on 2026-08-02 (services.js SVC_STATE.inquiry + click routing)
-- and CANNOT ACTIVATE without this migration. Verified against the live database on 2026-08-02:
--   PATCH store_products SET availability='<not in the list>'  ->  HTTP 400, code 23514
-- The CHECK below is the only thing standing between the deployed code and a working inquiry lane.
-- Without it, `UPDATE ... SET availability='inquiry'` fails and the button never changes.
--
-- ── THIS IS A BRIDGE, NOT A DEMOLITION ───────────────────────────────────────
-- Nothing is removed. 'live' still works exactly as before, the cart still works, Stripe still
-- works, and moving a service back is a one-row UPDATE with NO DEPLOY — site-state.js re-polls
-- availability every 60s. The switch is left in on purpose, so a service can graduate to
-- self-serve the moment the autonomous path earns it.
--
-- Design: E:\Plans\INQUIRY-LANE-AND-AUTONOMY-LADDER.md

-- ── THE MIGRATION ────────────────────────────────────────────────────────────
-- Safe to re-run. Adds a value to an allow-list; widens what is permitted and rejects nothing that
-- was previously accepted, so no existing row can violate it.
ALTER TABLE public.store_products
  DROP CONSTRAINT IF EXISTS store_products_availability_chk;

ALTER TABLE public.store_products
  ADD CONSTRAINT store_products_availability_chk
  CHECK (availability IN ('live','inquiry','soon','paused','waitlist','hidden'));

COMMENT ON COLUMN public.store_products.availability IS
  'live = self-serve checkout · inquiry = "Request a Quote", owner quotes and fulfils by hand · '
  'soon = visible, disabled · paused = visible, at capacity · waitlist = capture interest · '
  'hidden = card not rendered. Read by docs/assets/js/site-state.js every 60s — changing this '
  'takes effect with no deploy.';

-- ── VERIFY (run this, do not assume) ─────────────────────────────────────────
-- Expect one row, and 'inquiry' present in the definition:
--
--   SELECT conname, pg_get_constraintdef(oid) AS def
--   FROM   pg_constraint
--   WHERE  conname = 'store_products_availability_chk';

-- ── TURNING THE LANE ON — DELIBERATELY NOT IN THIS FILE ──────────────────────
-- The row-flipping statements live in task #64, NOT here. Two reasons, and the second one is the
-- one that matters:
--
--   1. Applying a schema change must never silently change what customers see. Widening an
--      allow-list and switching the storefront's behaviour are different decisions on different
--      days.
--   2. tools/migrate.mjs REFUSES any file containing a data-modifying statement, and it scans the
--      RAW TEXT — comments included. An earlier draft of this file carried the flip statements as
--      commented-out examples and was correctly refused as destructive. The gate was right and the
--      file was wrong: a migration should contain only what it runs. Do not re-add them, and do
--      not reach for --allow-destructive to push a file past a check that is doing its job.
--
-- The preview query, the flip, and the one-line reversal are all recorded in task #64.
-- Reversal needs no deploy: site-state.js re-reads availability every 60s.
--
-- ── READ THIS BEFORE FLIPPING ────────────────────────────────────────────────
-- Three known gaps make a full flip premature until they are closed (see the task log):
--   1. docs/store.html renders an unguarded Add/Buy button for every published product with
--      price_cents > 0, built by main.js, IGNORING availability entirely. A service flipped to
--      'inquiry' would still be purchasable from the store page.
--   2. The services.html "Online ordering coming soon" banner counts only 'live' services, so
--      flipping everything turns that banner back ON above a page of working quote buttons.
--   3. functions/api/create-checkout-session.js never checks availability, so a stale cart or a
--      replayed request can still mint a Stripe session for an inquiry-only service.
-- Applying THIS FILE is safe and changes nothing on its own. Flipping products is what waits.
