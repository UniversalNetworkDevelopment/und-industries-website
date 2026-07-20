-- 03_availability_and_site_status.sql
-- U.N.D — ONE source of truth for what is sellable and what the site is doing.
-- Written 2026-07-19.
--
-- WHY THIS EXISTS
-- Availability currently lives in a HARDCODED JS object (docs/assets/js/services.js
-- `SERVICES`, where a 'PLACEHOLDER_' pay link means "Coming soon"). check-prices.mjs:126
-- derives state from that same object, not from the database. So turning one service off
-- requires a code edit AND a deploy — which is how the buy buttons ended up disabled for
-- 32 days after 2026-06-17 with no way to flip them back without a push.
--
-- After this migration, availability is DATA. Alex can pause a single service, or the whole
-- store, from the Supabase dashboard on his phone, with no deploy and no developer.
--
-- SAFETY: additive only. No drops, no destructive changes. Defaults are chosen so that
-- running this changes NOTHING visible until a value is deliberately set.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PER-SERVICE AVAILABILITY
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'soon';

-- Allowed values, and exactly what each renders as on the site:
--   'live'     → real buy button, adds to cart, goes to Stripe checkout
--   'soon'     → visible card, disabled "Coming Soon" button + Inquire link  (CURRENT DEFAULT)
--   'paused'   → visible card, "Temporarily unavailable" + Inquire link
--                (use when at capacity — keeps the listing, stops the orders)
--   'waitlist' → visible card, "Join the waitlist" → captures interest instead of payment
--   'hidden'   → card is not rendered at all
ALTER TABLE public.store_products
  DROP CONSTRAINT IF EXISTS store_products_availability_chk;
ALTER TABLE public.store_products
  ADD CONSTRAINT store_products_availability_chk
  CHECK (availability IN ('live','soon','paused','waitlist','hidden'));

-- Optional per-service note shown under the button (e.g. "Back Aug 1", "2 slots left").
ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS availability_note text;

COMMENT ON COLUMN public.store_products.availability IS
  'Controls the buy button. live|soon|paused|waitlist|hidden. Changing this takes effect on next page load - NO DEPLOY NEEDED.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SITE-WIDE STATUS  (one row, id = 1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_status (
  id            smallint PRIMARY KEY DEFAULT 1,
  mode          text NOT NULL DEFAULT 'open',
  headline      text,
  message       text,
  eta           text,
  build_version text NOT NULL DEFAULT '1',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_status_single_row CHECK (id = 1),
  CONSTRAINT site_status_mode_chk CHECK (mode IN ('open','notice','degraded','maintenance','closed'))
);

--   'open'        → normal. No banner.
--   'notice'      → normal + a dismissible info banner (announcements, promos)
--   'degraded'    → site usable, banner warns something is impaired; buying still allowed
--   'maintenance' → FULL-SCREEN splash, no purchasing. Use while deploying/working.
--   'closed'      → site browsable, ALL purchasing disabled, explanatory banner
--
-- build_version: bump this on every deploy. Clients poll it and reload when it changes,
-- so nobody sits on a half-updated page mid-push.

INSERT INTO public.site_status (id, mode, headline, message, eta, build_version)
VALUES (1, 'open', NULL, NULL, NULL, '1')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.site_status IS
  'Single-row site control. mode drives banners/splash; build_version drives client auto-reload. No deploy needed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — the public must READ this, and must never WRITE it
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.site_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read site status" ON public.site_status;
CREATE POLICY "anyone can read site status"
  ON public.site_status FOR SELECT
  USING (true);

-- No INSERT/UPDATE/DELETE policy is created on purpose. With RLS enabled and no write
-- policy, anon and authenticated CANNOT modify it. Only the service_role key (server-side)
-- and the Supabase dashboard can. A visitor must never be able to take the store offline.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SEED the three services that are genuinely ready
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything defaults to 'soon', so this migration alone changes NOTHING that customers see.
-- These three stay 'soon' until fulfilment is wired and the MSA is reviewed.
-- THE MOMENT TO FLIP THEM IS DEFINED IN: PAYMENTS-REENABLE-RUNBOOK.md
--
-- When ready, run ONLY this:
--
--   UPDATE public.store_products SET availability = 'live'
--   WHERE slug IN ('website-fix-quick','website-fix-bundle','website-fix-cleanup');
--
-- To close the store instantly at any time, from anywhere:
--
--   UPDATE public.site_status SET mode = 'closed',
--     headline = 'Orders paused',
--     message  = 'We are at capacity and have paused new orders so current work gets done properly.',
--     eta      = 'Back shortly'
--   WHERE id = 1;
--
-- To go into maintenance while deploying:
--
--   UPDATE public.site_status SET mode = 'maintenance',
--     headline = 'Back in a few minutes',
--     message  = 'We are shipping an update.',
--     eta      = '~10 minutes'
--   WHERE id = 1;
--
-- After any deploy, bump the version so open browsers refresh themselves:
--
--   UPDATE public.site_status
--   SET build_version = (build_version::int + 1)::text, updated_at = now()
--   WHERE id = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VERIFY (run these after; they should return sane rows)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT slug, price_cents/100.0 AS dollars, is_published, availability, availability_note
--   FROM public.store_products ORDER BY slug;
-- SELECT * FROM public.site_status;
