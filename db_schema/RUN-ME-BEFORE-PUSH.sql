-- ============================================================================
-- RUN-ME-BEFORE-PUSH.sql
-- Paste this whole file into the Supabase SQL editor and run it ONCE.
--   Supabase dashboard -> project wgcgzuflpxijhzlpphab -> SQL Editor -> New query
--
-- WHY THIS IS BLOCKING
-- The website's JavaScript was changed so that buy buttons are driven by DATA
-- (store_products.availability) instead of a hardcoded list. That column does not
-- exist in this project yet. Verified live 2026-07-20:
--     GET /rest/v1/store_products?select=slug,availability
--     -> 400  "column store_products.availability does not exist"
--
-- site-state.js catches that error and leaves the availability map EMPTY.
-- availabilityOf(slug) then returns 'soon' for every service, canPurchase() returns
-- false, and services.js renders EVERY BUY BUTTON DISABLED.
--
-- So deploying the new code WITHOUT running this would take the entire store offline —
-- the same failure that cost 32 days at $0 revenue after 2026-06-17.
--
-- Every test suite passed while this was true. Mocked tests cannot catch it: the mock
-- always has the column. Only asking the real database catches it, which is now what
-- tools/preflight.mjs does, wired to the git pre-push hook.
--
-- SAFETY: additive only. No DROP, no data loss. Safe to re-run.
-- ============================================================================


-- ── STEP 1 — create the availability + site_status machinery ────────────────
-- The full script lives in db_schema/03_availability_and_site_status.sql.
-- Run that file first, then come back here for steps 2 and 3.
--
-- It creates:
--   store_products.availability       ('live'|'soon'|'paused'|'waitlist'|'hidden')
--   store_products.availability_note  (optional line under the button)
--   site_status                       (one row, id=1 — the maintenance/splash switch)
--
-- NOTE: it defaults every product to 'soon'. Running it alone is only HALF the job —
-- your store would still show zero buy buttons. Step 2 is what actually opens the shop.


-- ── STEP 2 — decide what is actually sellable ───────────────────────────────
-- THIS is the step that turns the buy buttons back on.
--
-- Set to 'live' only what you can genuinely deliver right now. Anything left 'soon'
-- still shows its card with a "Coming Soon" button and an Inquire link, so you lose
-- nothing by being conservative — an order you cannot fulfil costs far more than an
-- order you never took.
--
-- The 15 published products currently in the database:
--     website-fix-quick        $99      consulting-session       $149
--     shopify-quick-cleanup    $149     auto-starter             $199
--     website-fix-bundle       $199     seo-overhaul             $249
--     shopify-dropshipping     $249     shopify-pro-upgrade      $299
--     website-fix-deep         $349     website-fix-cleanup      $349
--     auto-advanced            $399     shopify-custom-upgrade   $499
--     website-bundle           $649     custom-agent             $1200
--     ai-integration           $3500

-- The website-fix tier: your core offering, smallest scope, fastest to deliver, and
-- the one the whole intake + fulfilment chain was actually built and tested around.
UPDATE public.store_products
   SET availability = 'live'
 WHERE slug IN (
   'website-fix-quick',
   'website-fix-bundle',
   'website-fix-deep',
   'website-fix-cleanup'
 );

-- Add more when you are ready. Uncomment what you can deliver:
-- UPDATE public.store_products SET availability = 'live'
--  WHERE slug IN ('shopify-quick-cleanup', 'shopify-pro-upgrade', 'seo-overhaul');
--
-- HOLD the big-ticket custom work (custom-agent $1200, ai-integration $3500) until the
-- services-agreement question is settled — see the legal note at the bottom.


-- ── STEP 3 — make sure the shop is actually OPEN ────────────────────────────
UPDATE public.site_status SET mode = 'open' WHERE id = 1;


-- ── VERIFY (run this after, and read the output) ────────────────────────────
-- Expect: 4+ rows with availability='live', and site mode='open'.
-- If live_count = 0, the store is open with nothing to buy.
SELECT availability, count(*) AS products, string_agg(slug, ', ' ORDER BY slug) AS which
  FROM public.store_products
 WHERE is_published = true
 GROUP BY availability
 ORDER BY availability;

SELECT id, mode, build_version FROM public.site_status WHERE id = 1;


-- ============================================================================
-- AFTER RUNNING THIS
--
--   1. cd E:\und-industries-website && node tools/preflight.mjs
--      It must print PREFLIGHT PASSED. It currently FAILS on exactly the problem
--      this file fixes, so it is a real check, not decoration.
--   2. git push   (the pre-push hook re-runs preflight and blocks if anything regressed)
--   3. Cloudflare Pages -> confirm the build SUCCEEDED. A red build means the live site
--      is still running the OLD code — a push is not a deploy.
--   4. Load the site LOGGED OUT and confirm buy buttons are enabled and one reaches
--      Stripe checkout. The database value is what we asked for; the rendered page is
--      what the customer gets.
--
-- STILL OUTSTANDING (this file does not fix these):
--   * AGENT_SERVICE_KEY — not set anywhere yet. Needed in BOTH Cloudflare Pages env AND
--     E:\UND-Keys\nexus.env, same value, so Qwep/Nexus can deliver through the website
--     and the CUSTOMER gets their completion + review email. Until then delivery falls
--     back to a direct write and logs loudly that the customer was not emailed.
--   * RESEND_API_KEY — missing from the vault, so the Qwep driver cannot email YOU when
--     it claims a paid order. Verified 2026-07-20 via tools/check-driver-config.js.
--     The job is still recorded to E:\Qwep\logs\jobs-pending.json either way.
--   * Stripe webhook registration — UNVERIFIED. If it is not registered, every line of
--     post-payment code is dead (no ticket, no email, no fulfilment) and the failure is
--     invisible because the card still charges.
--   * LEGAL: the published Terms say nothing about accessing a customer's website, and
--     actively prohibit credential sharing, while the intake flow asks for access. The
--     services agreement that covers this properly is an unpublished draft. Needs a
--     decision before selling the high-touch custom work.
-- ============================================================================
