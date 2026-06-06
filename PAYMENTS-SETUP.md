# Payments Setup & Operations Runbook

Stripe payments for the U.N.D Industries site. This is the human-facing setup and
operations guide for the payments backend implemented as Cloudflare Pages Functions.

- **Site:** static HTML in `docs/`, hosted on Cloudflare Pages
- **Live URL:** https://und-industries-website.pages.dev
- **Repo:** `UniversalNetworkDevelopment/und-industries-website` (production branch `main`, build output dir `docs`)
- **Backend:** Supabase (`https://wgcgzuflpxijhzlpphab.supabase.co`)
- **Payments API:** Cloudflare Pages Functions in `functions/` at the repo root

> The `functions/` directory lives at the **repo root**, independent of the `docs`
> build output dir. Cloudflare Pages compiles it automatically for dashboard-connected
> projects — no `wrangler.toml` is required.

---

## 1. Overview & architecture

Three endpoints back the store and (future) subscriptions:

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/create-checkout-session` | POST | Start a Stripe Checkout session | `Authorization: Bearer <supabase access token>` |
| `/api/stripe-webhook` | POST | Receive Stripe events (Stripe → site) | Stripe signature (no bearer) |
| `/api/create-portal-session` | POST | Open the Stripe Billing Portal for a subscriber | `Authorization: Bearer <supabase access token>` |

**Request bodies for `/api/create-checkout-session`:**
- `{ "slug": "..." }` → one-time purchase of a store product (live today)
- `{ "priceId": "..." }` → subscription checkout (scaffolded; used once plans exist)

### Flow

```
                         Authorization: Bearer <supabase JWT>
  Browser  ───────────────────────────────────────────────►  /api/create-checkout-session
 (store.html)                                                        │
                                                                     │  price resolved SERVER-SIDE
                                                                     │  from Supabase by slug
                                                                     ▼
                                                            Stripe Checkout (hosted page)
                                                                     │
                                       buyer pays  ─────────────────►│
                                                                     │
                            Stripe  ──── POST /api/stripe-webhook ───►  (signed event)
                                                                     │  verify signature
                                                                     │  dedupe (exactly-once)
                                                                     ▼
                                                              Supabase (service role)
                                              purchases · entitlements · subscriptions · profiles
                                                                     │
  Browser  ◄──── redirect to /purchase-complete.html ───────────────┘
 (reads its OWN rows via RLS: entitlement + license key)
```

### What's live vs scaffolded

- **Live today:** one-time digital-goods purchases (`{slug}` path). On success the
  webhook records a `purchases` row and grants an `entitlements` row. Software products
  (`type = software`) also get a generated license key (prefix `ECAM`).
- **Scaffolded (ready, not yet wired to a product):** subscriptions. The `{priceId}`
  checkout path, the billing portal endpoint, the `subscriptions` and `plans` tables,
  and the `customer.subscription.*` webhook handlers all exist. They activate once you
  populate the `plans` table and create Stripe Prices.

---

## 2. Environment variables

All variables are read from `context.env` in the Functions. Set them in
**Cloudflare Pages → Settings → Variables and Secrets**. Mark every secret **Encrypt**.
They must exist for **both** the Production and Preview environments, and a **redeploy is
required** after adding or changing any of them.

| Name | Example value | Secret? | Used by | Notes |
|------|---------------|:-------:|---------|-------|
| `STRIPE_SECRET_KEY` | `rk_test_51...` | **Yes** | checkout, portal | Stripe API auth. Prefer a **restricted** key (`rk_`) with least-privilege scopes over a full secret key (`sk_`). Use a **test** key first (`rk_test_`/`sk_test_`), then swap to live. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | **Yes** | webhook | Signing secret of the registered webhook endpoint. Verifies every inbound event. |
| `STRIPE_TAX_ENABLED` | `false` | No | checkout | String `"true"`/`"false"`. Passed to `automatic_tax.enabled`. Keep `"false"` until Stripe Tax + a business address are configured, or checkout creation errors. |
| `STRIPE_API_VERSION` | `2026-05-27.dahlia` | No | checkout, portal, customers | Optional. Sent as the `Stripe-Version` header. Code defaults to `2026-05-27.dahlia` when unset. |
| `SUPABASE_URL` | `https://wgcgzuflpxijhzlpphab.supabase.co` | No | all | Supabase project URL. |
| `SUPABASE_ANON_KEY` | `eyJ...` (public anon JWT) | No | checkout, portal | Public anon key. Used **only** to verify the caller's access token at `/auth/v1/user`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (service_role JWT) | **Yes** | webhook, checkout, portal | Bypasses RLS. Server-only. **Never** in the browser, repo, or a public var. |
| `ALLOWED_ORIGINS` | `https://und-industries-website.pages.dev` | No | cors (all) | Optional, comma-separated. Locks CORS to listed origins. When unset, behaviour is same-origin/echo (fine for the single pages.dev origin). |

> Restricted-key behaviour: with `STRIPE_TAX_ENABLED="false"`, no Tax scope is needed.
> If you later enable tax, the key needs the matching Tax read scope.

---

## 3. Stripe dashboard setup

1. **Create / open a Stripe account** at https://dashboard.stripe.com. Keep the
   **Test mode** toggle ON for everything below until you have verified end-to-end.

2. **Create a restricted API key.**
   Developers → API keys → **Create restricted key**. Give it least-privilege write
   access. Grant (Write unless noted):
   - **Checkout Sessions** — Write
   - **Customers** — Write
   - **Billing Portal** — Write
   - **Subscriptions** — Read (for the subscription scaffolding / later use)
   - **Prices** — Read (for the subscription scaffolding / later use)

   Copy the generated `rk_test_...` value → this becomes `STRIPE_SECRET_KEY`.
   (A full `sk_test_...` secret key also works but grants more than needed.)

3. **Register the webhook endpoint.**
   Developers → Webhooks → **Add endpoint**.
   - **Endpoint URL:** `https://und-industries-website.pages.dev/api/stripe-webhook`
   - **Events to send** (subscribe to exactly these):
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Save, then open the endpoint and **reveal the Signing secret** (`whsec_...`) →
     this becomes `STRIPE_WEBHOOK_SECRET`.

4. **Test card** for the hosted Checkout page:
   `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.

---

## 4. Supabase setup

1. **Run the schema.** Supabase Dashboard → SQL Editor → paste and run
   `supabase/payments_schema.sql`. It is **idempotent** (safe to re-run). It creates:
   `customers`, `purchases`, `entitlements`, `subscriptions`, `plans`, `webhook_events`;
   adds `plan`, `plan_status`, `plan_renews_at` columns to `profiles`; and enables RLS.

2. **RLS posture.** Row-Level Security is ON for all payment tables. Users may
   **read only their own rows** (`auth.uid() = user_id`); `plans` exposes only
   `active = true` rows; `webhook_events` has no policy at all (service-role only).
   There are **no INSERT/UPDATE policies by design** — all writes come from the Functions
   using the service-role key, which bypasses RLS.

3. **Auth redirect URL.** The `https://und-industries-website.pages.dev` redirect URL is
   already added to Supabase Auth. Confirm under Authentication → URL Configuration if you
   change domains. (Checkout success/cancel URLs are derived from the request origin, so
   they follow whatever domain serves the function.)

---

## 5. Cloudflare Pages setup

1. **Add the env vars.** Cloudflare Dashboard → your Pages project → **Settings →
   Variables and Secrets**. Add every variable from §2.
   - Click **Encrypt** for each secret (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
     `SUPABASE_SERVICE_ROLE_KEY`).
   - Add them to **both** the **Production** and **Preview** environments. Preview
     deployments run the same Functions and will fail without the vars.

2. **Redeploy.** Variable changes do **not** apply to already-built deployments.
   Trigger a redeploy (Deployments → Retry deployment, or push a commit) after any change.

3. **Confirm Functions are detected.** A successful build log includes a line like:

   ```
   Found Functions directory at /functions. Compiling worker...
   ```

   Pages auto-detects `functions/` at the repo root. No `wrangler.toml` is needed for a
   dashboard-connected project.

---

## 6. Deployment checklist (zero → live)

Copy-paste-friendly, in order. Do the **test-mode** pass first, then repeat steps 1–3 with
live keys for go-live (§10).

```
[ ] 1.  Supabase: run supabase/payments_schema.sql in the SQL Editor (idempotent).
[ ] 2.  Stripe (Test mode): create restricted key rk_test_... with scopes:
        Checkout Sessions=Write, Customers=Write, Billing Portal=Write,
        Subscriptions=Read, Prices=Read.
[ ] 3.  Stripe (Test mode): add webhook endpoint
        https://und-industries-website.pages.dev/api/stripe-webhook
        events: checkout.session.completed, customer.subscription.created,
        customer.subscription.updated, customer.subscription.deleted,
        invoice.payment_failed. Copy the whsec_... signing secret.
[ ] 4.  Cloudflare Pages → Settings → Variables and Secrets: add all §2 vars to
        BOTH Production and Preview. Encrypt the three secrets.
        Keep STRIPE_TAX_ENABLED="false" for now.
[ ] 5.  Trigger a redeploy.
[ ] 6.  Confirm the build log shows "Found Functions directory at /functions".
[ ] 7.  On the live site: sign in, buy a test product with card 4242 4242 4242 4242.
[ ] 8.  Verify the redirect to /purchase-complete.html (license key shown for software).
[ ] 9.  Supabase: confirm new rows in purchases + entitlements (+ webhook_events).
[ ] 10. Stripe → Webhooks → endpoint: confirm the event shows a 200 response.
```

---

## 7. Local development

Run the Functions alongside the static site with Wrangler, and forward Stripe events with
the Stripe CLI.

1. **Create your local secrets file** from the template (the real file is gitignored):

   ```bash
   cp .dev.vars.example .dev.vars        # macOS/Linux
   ```
   ```powershell
   Copy-Item .dev.vars.example .dev.vars # PowerShell
   ```
   Fill in **test-mode** values.

2. **Run the site + functions:**

   ```bash
   npx wrangler pages dev docs
   ```
   This serves `docs/` and runs `functions/` together. Default URL:
   `http://localhost:8788`. Wrangler loads `.dev.vars` into `context.env` automatically.

3. **Forward Stripe webhooks** (separate terminal). The Stripe CLI prints a local
   `whsec_...`; put that value in your `.dev.vars` `STRIPE_WEBHOOK_SECRET` and restart
   wrangler so signatures verify:

   ```bash
   stripe listen --forward-to http://localhost:8788/api/stripe-webhook
   ```

4. **Trigger a test event:**

   ```bash
   stripe trigger checkout.session.completed
   ```

> Tip: for a real round-trip (with your product metadata and a real session id), drive an
> actual checkout from the local store page rather than `stripe trigger`, which sends a
> synthetic object that may not carry your `metadata`/`client_reference_id`.

---

## 8. Test plan

### Happy path

1. Sign in on the site.
2. Buy a product; pay with `4242 4242 4242 4242`.
3. Land on `/purchase-complete.html`. For a **software** product, a license key
   (format `ECAM-XXXX-XXXX-XXXX-XXXX`) is shown/available.
4. In Supabase, confirm:
   - `purchases` — one row, `status = 'paid'`, correct `amount_cents`/`currency`.
   - `entitlements` — one row, `status = 'active'`; `license_key` set for software.
   - `webhook_events` — one row with the Stripe `evt_...` id.
   - `customers` — a `stripe_customer_id` mapped to your `user_id`.
5. Stripe → Webhooks shows the event delivered with a **200**.

### Negative tests

| Test | How | Expected |
|------|-----|----------|
| Bad webhook signature | POST to `/api/stripe-webhook` with a wrong/garbage `Stripe-Signature` | `400 Invalid signature`; nothing written |
| Replayed / duplicate event | Re-deliver the same `evt_...` (Stripe "Resend", or trigger twice) | First fulfils; subsequent returns `200 {"duplicate":true}`, **no** double grant |
| Unauthenticated checkout | POST `/api/create-checkout-session` with no/invalid bearer token | `401` "You must be signed in to check out." |
| Tampered price | Try to override amount from the client | Impossible — price is resolved **server-side** by `slug` from Supabase; the client never sends an amount |
| Unknown / unsellable product | POST `{slug}` for a missing product or one with `price_cents <= 0` | `404` "Product not found." / `400` "This product is not for sale." |

---

## 9. Webhook security

The webhook handler (`functions/api/stripe-webhook.js` + `functions/util/stripe.js`)
defends against forgery, tampering, replay, and double-fulfilment:

- **Signature verification (HMAC-SHA256, Web Crypto).** The raw request body is read
  **before** parsing. The `Stripe-Signature` header (`t=<ts>,v1=<sig>`) is verified by
  recomputing `HMAC_SHA256(secret, "<ts>.<rawBody>")` with `STRIPE_WEBHOOK_SECRET`. An
  invalid signature → `400`, no side effects. (Reading the raw body first matters: parsing
  before verifying would change the bytes and break the check.)
- **Replay window (5 minutes).** If the signed timestamp is more than 300 seconds from
  "now," the request is rejected. A captured-and-replayed old request fails.
- **Constant-time comparison.** The computed and expected signatures are compared with
  `crypto.subtle.timingSafeEqual` (with a length-mismatch guard that still runs a compare),
  so an attacker can't learn the signature byte-by-byte via response timing.
- **Idempotency / exactly-once.** Each event id is inserted into `webhook_events` (its
  primary key). A duplicate insert returns `409` → the handler treats the event as already
  processed and acks with `200` without re-fulfilling. Stripe retries on any non-2xx, so
  every handler is written to be safe to run again.
- **Service-role isolation.** All DB writes use `SUPABASE_SERVICE_ROLE_KEY`, which lives
  only in Cloudflare env and is never exposed to the browser. RLS blocks any client write.

---

## 10. Going live

1. **Switch to live keys.** In Stripe, flip off Test mode and create a **live** restricted
   key (`rk_live_...`) with the same scopes (§3). Add a **live** webhook endpoint (same URL,
   same events) and copy its **live** `whsec_...`.
2. **Update Cloudflare env** (Production env): set `STRIPE_SECRET_KEY` to the live key and
   `STRIPE_WEBHOOK_SECRET` to the live signing secret. **Redeploy.**
3. **Enable Stripe Tax** *(only after configuring it)*: in Stripe, set up Stripe Tax and a
   business/origin address, then set `STRIPE_TAX_ENABLED="true"` and redeploy. If you flip
   this on **before** configuring Tax, checkout creation will error.
4. **Rotate/secure keys.** Keep restricted keys least-privilege; rotate immediately if a key
   is ever exposed. Never store live keys in `.dev.vars` or anywhere in the repo.
5. **Add a pre-commit secret guard.** A lightweight defense-in-depth so a key never lands in
   git. Example using `gitleaks` (install separately):

   ```bash
   # .git/hooks/pre-commit  (chmod +x it)
   #!/bin/sh
   gitleaks protect --staged --redact --no-banner || {
     echo "gitleaks: potential secret in staged changes — commit blocked."; exit 1; }
   ```

   `.dev.vars`, `.env*`, `*.key`, `*.secret`, and `secrets/` are already gitignored, so the
   guard is a backstop, not the primary control.

---

## 11. Merchant-of-Record / tax note

Honest callout, not a blocker. With **raw Stripe**, the LLC is the **Merchant of Record**:
**you** are responsible for collecting and remitting sales tax / VAT / GST where you have
obligations. **Stripe Tax** (the `STRIPE_TAX_ENABLED` switch) helps **calculate and collect**
the right amount, but it does **not** make Stripe the seller of record — registration and
remittance remain yours.

Alternatives like **Lemon Squeezy** or **Paddle** act as the **Merchant of Record**: they
become the seller, handle tax calculation, collection, and remittance globally, and you
receive payouts — at the cost of a **higher per-sale cut**.

This is a **business decision**, not a technical one. The current build uses **Stripe per the
owner's choice**. If MoR offloading becomes worth the higher fee later, it would be a separate
integration, not a fix to this one.

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `502` from `/api/create-checkout-session` | Bad/missing `STRIPE_SECRET_KEY` (wrong mode, typo, missing scope, not set in this environment) | Verify the key value/scopes; confirm it's set for the **right** env (Prod vs Preview); redeploy |
| Checkout fails with an `automatic_tax`/tax error | `STRIPE_TAX_ENABLED="true"` without Stripe Tax + business address configured | Set it back to `"false"` (redeploy), or finish Stripe Tax setup first |
| Webhook returns `400` | Wrong `STRIPE_WEBHOOK_SECRET`, or the body was altered before signature verification | Use the signing secret from the **exact** endpoint (and matching test/live mode); locally use the secret `stripe listen` printed; redeploy |
| Entitlement/purchase never appears | Webhook not registered, wrong events subscribed, or SQL not run | Confirm the endpoint URL + the five events; check the event's response in Stripe is 200; confirm `payments_schema.sql` ran |
| `401` on checkout | No/invalid Supabase access token in `Authorization: Bearer ...` | Ensure the user is signed in and the current access token is sent; refresh the session if expired |
| Env var change "didn't take" | Cloudflare applies vars at **build/deploy** time | **Redeploy** after any variable change |
| Works in Production but fails in a Preview deploy | Vars only set for Production | Add the same vars to the **Preview** environment too |
| Webhook `500` (Storage/Provisioning failed) | Transient Supabase/DB error during fulfilment | Stripe auto-retries with backoff; handlers are idempotent so retries are safe. Check Supabase availability and the function logs |

### Where to look

- **Function logs:** Cloudflare Pages → your project → Deployments → (deployment) →
  Functions / Real-time logs. Stripe internals are logged here, not returned to the client.
- **Webhook delivery + payloads:** Stripe Dashboard → Developers → Webhooks → (endpoint) →
  event list (status code, response, "Resend").
- **Data:** Supabase → Table Editor (`purchases`, `entitlements`, `webhook_events`,
  `customers`, `subscriptions`).
