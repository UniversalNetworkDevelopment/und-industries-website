-- 07_customer_legal_name.sql
-- Gives a customer record a real, enforceable identity.
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────────
-- Verified against the live database on 2026-08-04:
--     customers        -> no name column of any kind
--     tos_consents     -> no name column of any kind
--     service_tickets  -> service_name only (the product, not a person)
--     Stripe sessions  -> customer_details.name was NULL on every session ever created,
--                         because create-checkout-session.js never asked for it
--
-- So the ONLY human-readable identifier anywhere in the system was profiles.display_name, which
-- currently holds: "Abyss", "Zolariz++", "nullthis.ttv", "(CEO) Alex". Handles.
--
-- ── WHY THAT IS NOT COSMETIC ─────────────────────────────────────────────────
-- Every compliance artefact this business collects binds a PERSON: the terms acknowledgement, the
-- non-refundable ack, the payment-final ack, and the authorisation to access the customer's own
-- systems. A record saying "Abyss agreed to the terms" identifies nobody. It can be disowned by
-- anyone, and it cannot be enforced against anyone. 37 consent rows exist and not one of them
-- names a human being.
--
-- The chain was broken at all four links at once: Stripe was not asked for a name, so the webhook
-- had none to read, so there was no column to store it in, so consent had nothing to reference.
-- Fixing any single link would have changed nothing.
--
-- ── WHY THE NAME COMES FROM STRIPE ───────────────────────────────────────────
-- billing_address_collection:'required' makes Stripe collect the CARDHOLDER name — a name the
-- card issuer has already verified against the payment instrument. That is materially stronger
-- evidence than a free-text field a customer types, which is exactly how "Dr Big 45" ends up on
-- a compliance record. The intake form deliberately does not collect a name at all, so this is
-- the first and only point where a verified one enters the system.
--
-- Related: functions/api/create-checkout-session.js (collection), functions/api/stripe-webhook.js
-- (capture + persist), functions/util/supabase.js saveCustomerMapping/getCustomerName.

-- ── THE MIGRATION ────────────────────────────────────────────────────────────
-- Additive and safe to re-run. Adds a nullable column; no existing row can violate it and no
-- existing behaviour changes. Deliberately NOT NOT-NULL: the 2 customers already on file
-- genuinely have no recorded name, and inventing one would be worse than admitting the gap.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS full_name text;

COMMENT ON COLUMN public.customers.full_name IS
  'Legal name as collected by Stripe Checkout (customer_details.name) — the cardholder name the '
  'issuer verified, NOT self-typed free text. Written only by the stripe-webhook on a completed '
  'payment. Null means genuinely unknown (pre-2026-08-04 customer, or an inquiry-lane customer '
  'who has not yet paid). Never overwrite a non-null value with null.';

-- Finding a customer by name is the FIRST thing anyone does in a dispute, a chargeback response
-- or a discovery request. Partial index: rows with no name are exactly the rows nobody searches.
CREATE INDEX IF NOT EXISTS customers_full_name_idx
  ON public.customers (full_name)
  WHERE full_name IS NOT NULL;

-- ── VERIFY (run it, do not assume) ───────────────────────────────────────────
--   SELECT column_name, data_type, is_nullable
--   FROM   information_schema.columns
--   WHERE  table_schema='public' AND table_name='customers' AND column_name='full_name';
--
-- Expect exactly one row: full_name | text | YES

-- ── WHAT THIS DOES NOT FIX — READ BEFORE CLOSING THE TASK ────────────────────
--  1. The 2 existing customers still have no name and cannot be given one retroactively. Stripe
--     has none stored for them either; it was never collected. They are identifiable by email
--     only, and that is the honest state of those records.
--  2. tos_consents STILL has no name of its own. It references user_id, so a name is reachable
--     by join once one exists — but a consent record that must be joined to be readable is weaker
--     evidence than one that carries the name at the moment of agreement. Consider stamping
--     full_name into the consent row's detail blob when it is created.
--  3. THE INQUIRY LANE HAS NO STRIPE STEP AT ALL. Every service is currently availability=
--     'inquiry', so no one reaches Checkout and no name is collected by this path today. For
--     quote-first work the name arrives from the quote form and from Alex actually speaking to
--     the person — which is stronger in practice, but it is a HUMAN control, not a system one.
--     Do not mark identity "solved" on the strength of this file alone.
