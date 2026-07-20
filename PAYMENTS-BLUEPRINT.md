# U.N.D Payments — Blueprint (modular, scalable, verifiable)

**Status:** LIVE on Stripe. Last verified end-to-end: **2026-07-10** (see "Verified state" below).
**Companion docs:** [PAYMENTS-DECISION-remove-paypal.md](PAYMENTS-DECISION-remove-paypal.md) (why PayPal is out) · `tools/check-prices.mjs` (the verifier).

This is the reference design for how money moves through U.N.D. It is written so a new
service, or even a whole new processor, can be added by following a checklist — without
re-reading the code every time.

---

## 1. The one invariant (never violate this)

> **The price a customer SEES must equal the price they are CHARGED, and the amount is
> ALWAYS resolved on the server from a trusted store — never sent by the browser.**

- **Seen:** `docs/assets/js/services.js` → `SERVICES[key].cents`
- **Charged:** Supabase `store_products.price_cents`, looked up by `slug` server-side.
- A tampered browser request cannot change the price or the buyer. The client sends a
  **slug**, not a dollar amount.

If those two numbers ever drift, a customer sees $99 and gets charged $129 — a silent,
unaccountable surprise. That is the exact behavior U.N.D exists to *not* do. `tools/check-prices.mjs`
exists to prove they match. Run it before every launch and after every price change.

---

## 2. The money flow (end to end)

```
 Browser (services.js)                Cloudflare Pages Function            Supabase (Postgres)      Stripe
 ─────────────────────                ─────────────────────────            ───────────────────      ──────
 1. User picks a service
 2. Agrees to Terms  ───────────────► writes service_tickets row ────────► service_tickets
                                       (consent proof, BEFORE pay)
 3. Clicks pay
    POST /api/create-checkout-session
      { items:[{slug}], ticket } ────► 4. auth caller via JWT ───────────► auth/v1/user
                                        5. getProductBySlug(slug) ────────► store_products  (PRICE AUTHORITY)
                                        6. build Stripe session
                                           with server-side price ───────────────────────────► create session
                                        7. return { url } ◄──────────────────────────────────── session.url
 8. Browser redirects to Stripe  ─────────────────────────────────────────────────────────────► hosted checkout
 9. Customer pays  ────────────────────────────────────────────────────────────────────────────► payment
10. Stripe fires webhook ──────────► /api/stripe-webhook
                                        11. verify signature
                                        12. idempotency (webhook_events)
                                        13. recordPurchase / grantEntitlement
                                            / markTicketPaid ─────────────► purchases, entitlements,
                                                                            service_tickets(status=paid)
14. Redirect to purchase-complete.html
```

Every numbered step is a seam you can inspect, log, override, or reverse. Nothing is a black box.

---

## 3. The modules (each is swappable)

| # | Module | File(s) | Responsibility | Swap without touching… |
|---|--------|---------|----------------|------------------------|
| A | **Catalog (display)** | `docs/assets/js/services.js` (`SERVICES`) | What the customer sees; the `slug` that identifies each product | the price authority or processor |
| B | **Price authority** | Supabase `store_products` + `functions/util/supabase.js::getProductBySlug` | The single source of truth for what is charged | display or processor |
| C | **Session creator** | `functions/api/create-checkout-session.js` | Turn a slug into a paid checkout session; **never trusts a client amount** | the display or the DB |
| D | **Processor adapter** | `functions/util/stripe.js` (+ Stripe) | The actual card rail | display, DB, or fulfillment |
| E | **Fulfillment** | `functions/api/stripe-webhook.js` + `supabase.js` writers | Grant what was bought, exactly once (idempotent) | the display or processor choice |
| F | **Verifier** | `tools/check-prices.mjs` | Prove display price == charged price for every item | everything (read-only) |

**Because B (price authority) is processor-agnostic, D (the processor) is a thin, replaceable
adapter.** That is the whole point of the design: the DB decides the price; the processor only
moves the money.

---

## 4. Scale: add a new service (the checklist)

1. **DB:** insert the product into `store_products` (Supabase SQL editor). Canonical seed lives
   in `supabase/store_products_update.sql` — add the row there too so the DB is reproducible.
   ```sql
   insert into public.store_products (slug, title, price_cents, type)
   values ('my-new-service', 'My New Service', 12900, 'service')
   on conflict (slug) do update set title=excluded.title, price_cents=excluded.price_cents, is_published=true;
   ```
2. **Display:** add an entry to `SERVICES` in `services.js` with the **same slug** and the
   **same cents**, and `pay: 'stripe'` (live) or a `PLACEHOLDER_` link (renders "Coming soon").
   ```js
   mykey: { slug: 'my-new-service', name: 'My New Service', cents: 12900, pay: 'stripe' },
   ```
3. **Verify:** `node tools/check-prices.mjs` → must print `ok` for the new slug.

That's it. No new endpoint, no processor change. This is what "scalable" means here: N products,
one code path.

`pay` sentinel meanings (Module A):
- `'stripe'` → **live**, routes through `create-checkout-session` (price by slug).
- `'https://buy.stripe.com/PLACEHOLDER_…'` → **not live**, button shows "Coming soon".
- `'https://www.paypal.com/checkout'` → **removed 2026-07-10**; do not use (see decision note).

---

## 5. Modularity: add or swap a payment processor

The design keeps one processor from being a single point of failure without ever letting a
processor set its own price.

To add a second rail (e.g. a reputable backup — **never PayPal**):

1. **Adapter:** create `functions/util/<proc>.js` with a `createSession/createOrder` that takes
   an **amount the caller already resolved** — the adapter never looks up price itself.
2. **Endpoint:** create `functions/api/create-<proc>-session.js` that mirrors
   `create-checkout-session.js` exactly: authenticate JWT → `getProductBySlug` (server-side price)
   → call the adapter → return the redirect URL. **Copy the security shape, not shortcuts.**
3. **Routing:** pick the rail with a `pay` sentinel in `services.js` (that is exactly how PayPal
   was selected, and how it was removed — one sentinel, one branch).
4. **Fulfillment:** add a webhook that verifies the processor's signature, is idempotent via
   `webhook_events`, and calls the same `recordPurchase / grantEntitlement / markTicketPaid`
   writers. Fulfillment is shared; only the rail differs.
5. **Verify + document:** extend `check-prices.mjs` if needed; write a decision note for *why*
   the processor was added or removed. **We never add or remove a rail silently.**

---

## 6. Security model (why a tampered client can't hurt you)

- **Price is server-only.** The browser sends a `slug`; the amount comes from `store_products`
  via the **service-role key**, which lives ONLY in Cloudflare encrypted env — never in the
  browser, never in git.
- **RLS.** `store_products` is publicly readable **only** where `is_published = true`; billing
  tables (`purchases`, `entitlements`, `customers`, `subscriptions`, `webhook_events`) are
  readable only by their owner and writable only by the service role. No client writes billing data.
- **Buyer is authenticated.** The checkout function derives the user from their Supabase JWT
  (`/auth/v1/user`) — it never trusts a client-sent user id.
- **Consent before pay.** A `service_tickets` row (timestamped agreement to Terms/Refund) is
  written *before* the user is sent to pay. If we can't record consent, we don't take money.
- **Exactly-once fulfillment.** The webhook records the event id in `webhook_events` only *after*
  fulfillment succeeds; a duplicate id is a no-op. No double-grants, no double-charges on retry.
- **Unpublished = inert.** `getProductBySlug` filters `is_published=true`, so an unpublished row
  (e.g. a test product) cannot be charged even if someone knows its slug.

---

## 7. Verify everything (the tool)

```
node tools/check-prices.mjs
```

- Reads Supabase creds from `.dev.vars` at runtime; **never prints the keys**.
- Prefers the service-role key so it also sees **unpublished** rows (a live-on-site but
  unpublished product would silently fail a sale — this catches it).
- Compares every `services.js` item to its `store_products` row.
- Exit `0` = safe, `1` = a drift/mismatch (do not sell affected item), `2` = couldn't run.

Result meanings:
- `ok` — displayed price == charged price, published. Good.
- `MISSING in Supabase` — the site offers a slug the DB doesn't have → charge fails. Add the row.
- `MISMATCH` — site and DB disagree on price → the surprise-charge risk. Fix one side.
- `LIVE on site but UNPUBLISHED` — the button is live but the DB row is hidden → charge fails. Publish it.

---

## 8. Verified state — 2026-07-10

`check-prices.mjs` result: **all 11 services-page items match** (displayed == charged). Safe.

| Live now (`pay:'stripe'`) | Price | | "Coming soon" (`PLACEHOLDER_`) | Price |
|---|---|---|---|---|
| website-fix-quick | $99 | | shopify-quick-cleanup | $149 |
| website-fix-bundle | $199 | | shopify-pro-upgrade | $299 |
| website-fix-cleanup | $349 | | shopify-dropshipping | $249 |
| | | | shopify-custom-upgrade | $499 |
| | | | auto-starter | $199 |
| | | | auto-advanced | $399 |
| | | | seo-overhaul | $249 |
| | | | consulting-session | $149 |

**Extra rows in Supabase (not on the services page) — flagged for review, not touched:**
- *Published (purchasable by slug if linked):* `ai-integration` $3500, `custom-agent` $1200,
  `website-bundle` $649, `website-fix-deep` $349. Likely sold via other pages (store/Nexus) or
  older catalog entries — confirm they're intentional or unpublish them.
- *Unpublished (inert, cannot be charged):* `automation`, `full_website_build_test` $5000 (a test
  row — safe to delete), `grant_atlas_subs`, `shopify`, `website`.

**Still open (cosmetic only — the money path is Stripe):** the words/buttons "PayPal" still appear
in some `docs/*.html` service pages and `purchase-complete`. They no longer route anywhere (the
sentinel is `stripe`), but they should be swept so nothing *reads* "PayPal".

---

## 9. Accountability mapping (why it's built this way)

This design is the deliberate opposite of the PayPal incident that got PayPal removed:

| Principle | In this system |
|---|---|
| **Explainable** | Every step (§2) is a named, inspectable seam; prices are a DB row you can read. |
| **Overridable** | You control Stripe from its dashboard; you set prices in Supabase; a human is always in the loop. |
| **Reversible** | PayPal was *disabled, not deleted*; refunds are one Stripe action; code paths are documented to reverse. |
| **Verifiable** | `check-prices.mjs` proves the invariant on demand — you never take "it's fine" on faith. |

No autonomous, unaccountable step touches money. That is the requirement, not a nicety.
