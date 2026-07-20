# DEPLOY RUNBOOK — UND Industries website

**Read this before every push.** The site auto-deploys from GitHub via Cloudflare Pages, so
`git push` **is** the deploy. There is no separate "publish" step and no staging gate.

---

## The rule Alex set (2026-07-20)

> "if you do sum pushing and or using the maintenance or associated splash screen then
> running the fix is important reminding yourself after to put the website back regular
> turning off the splash screen"

**Maintenance mode is a loan, not a state.** Every time it goes on, it must come off in the
same working session. A splash screen left up is a closed shop: the site looks broken, buy
buttons are hidden, and nobody can pay. That is worse than the bug being fixed, because the
bug might only affect some visitors while the splash affects every one of them.

The failure mode is not forgetting the splash exists — it is finishing the fix, feeling done,
and ending the session. **Turning it off is part of the fix, not cleanup afterwards.**

---

## Maintenance mode is DATA, not code

It lives in the `site_status` table and is read by `docs/assets/js/site-state.js`. Flipping it
needs **no deploy and no developer** — it can be changed from the Supabase dashboard on a
phone. That is deliberate: hardcoded availability is how the buy buttons stayed disabled for
32 days after 2026-06-17 with no way to flip them back.

| mode | what the visitor sees | buy buttons |
|---|---|---|
| `open` | normal site | live |
| `notice` | banner, site works | live |
| `degraded` | amber banner | live |
| `maintenance` | **full-screen splash** | blocked |
| `closed` | red banner | waitlist only |

`SPLASH_EXEMPT` in `site-state.js` keeps the splash OFF `purchase-complete`, `service-intake`,
`maintenance` and `dashboard` — stranding someone who has already paid, mid-transaction, is
the one thing maintenance mode must never do.

---

## Procedure

### 1. Decide whether you need maintenance mode at all

Most deploys do **not**. Cloudflare Pages swaps the build atomically; a normal push causes no
downtime. Use maintenance mode only when:

- a **schema migration** runs that the live JS cannot tolerate mid-flight, or
- checkout/payment code is in a **known-broken** state, or
- you are changing something a customer could hit **halfway through** an order.

If none of those apply, skip to step 3. An unnecessary splash costs real money.

### 2. If you do need it — turn it ON

Supabase → Table editor → `site_status` → set `mode = 'maintenance'`, write a real
`headline`/`message` and an honest `eta`. **Write the "off" step into your task list in the
same minute you turn it on.** Not at the end — now, while you are thinking about it.

### 3. Push

```bash
cd E:/und-industries-website
node tools/test-flow-integration.mjs      # order flow, mocked Supabase + Resend
node tools/test-chain-integration.mjs     # website <-> Nexus <-> Qwep seam
node tools/test-email-encoding.mjs        # customer-facing text (mojibake gate)
node tools/test-access-consent.mjs        # access authorisation record
node tools/check-prices.mjs               # seen price == charged price
git add -A && git commit -m "..."
git push
```

All five must pass **before** the commit. They are cheap; a broken receipt or a wrong price
in front of a customer is not.

### 4. Verify the deploy actually landed

Cloudflare Pages → Deployments → confirm the build **succeeded** (a red build means the live
site is still the OLD code — a push is not a deploy). Then load the real site and check the
thing you changed is actually there. `site-state.js` bumps `build_version` and auto-reloads
open tabs; it deliberately waits if the user is mid-form (`userIsBusy()`).

### 5. Turn maintenance mode OFF — same session, always

Set `mode = 'open'`. Then **load the site as a stranger would** (logged out, hard refresh) and
confirm:

- no splash, no banner
- services render with **enabled** buy buttons
- one buy button actually reaches Stripe checkout

Do not trust the database value alone. `mode='open'` is what we *asked* for; the rendered page
is what the customer *gets*. Assert on what rendered.

---

## Before the first real push, these must be true

A push cannot fix these — they live outside the repo, and if any is missing the deployed code
silently does nothing:

- [ ] Cloudflare env vars set: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `OWNER_USER_ID`, `OWNER_EMAIL`,
      `AGENT_SERVICE_KEY`
- [ ] SQL migrations run: `fulfillment_chain.sql`, `03_availability_and_site_status.sql`,
      `04_service_reviews.sql` (site_status must exist or maintenance mode cannot be turned
      on **at all** — the switch is only as real as its table)
- [ ] Stripe webhook registered and pointing at `/api/stripe-webhook`. **If it is not
      registered, every line of post-payment code is dead** — no ticket, no email, no
      fulfilment — and the failure is invisible because the customer's card still charges.
- [ ] Resend sending domain verified (unverified = customer emails silently do not arrive)
- [ ] `AGENT_SERVICE_KEY` also present in `E:\UND-Keys\nexus.env` so Qwep and Nexus can
      deliver through the site

---

## Rollback

```bash
git revert HEAD && git push      # preferred: forward-only, keeps the history honest
```
Or Cloudflare Pages → Deployments → an earlier build → **Rollback** (instant, no rebuild).
Prefer the Cloudflare rollback when a customer is actively affected — it is seconds, not
minutes.
