# Payment Processor Decision — Remove PayPal, run Stripe (2026-07-10)

**Decision:** PayPal is removed from the U.N.D payment stack. Payments run through **Stripe** only.

## This is not a ban for no reason. Here is the reason.
(Documented deliberately — accountability is the entire point. We do not remove things silently.)

PayPal's autonomous system, acting on a **fully verified business account** (EIN verified):
- **Emailed a prompt to "add money."**
- **Then DENIED the ability to add money** — not "pending," not "needs verification," a flat no.
- **Still charged $1.97** from the linked bank anyway.
- Support could not explain it: first "a verification-code charge," then "your ability to add money is locked," then "the system can randomly do that — for reasons… or no reasons."
- **No human could reverse it, override it, or make the system behave.**

## Why this disqualifies PayPal as an income processor (not just an annoyance)
An unaccountable, autonomous system that can **lock features and charge a verified business account for no stated reason, with no human recourse, is a direct threat to income.** If it can randomly lock account features, it can freeze the very funds customers pay us. A business that cannot absorb a frozen income rail cannot accept that risk. **The $1.97 is not the point — the powerlessness and unaccountability are.**

## Principle
U.N.D builds and uses systems that **explain themselves, can be overridden, and can be reversed, with a human in control.** PayPal's "AI gremlin" is the exact opposite of that. So it's out.

## Decision details
- **Stripe** is the sole active processor. It was already integrated (Qwep stack), it is developer-controlled, predictable, and reversible from its dashboard.
- **PayPal code is DISABLED, not hard-deleted** — because we don't do irreversible things either. It can be re-enabled if ever warranted; the account-lock risk stands.
- **Redundancy note:** with PayPal out, Stripe is the single processor. If a backup rail is wanted later for resilience, add a *reputable* second processor — never PayPal.

## As-built — what was actually changed (2026-07-10)

**DONE (the money path no longer touches PayPal):**
1. **Frontend reroute** — `docs/assets/js/services.js`: the three live Website Fixes
   (`website-fix-quick/bundle/cleanup`) had their `pay` sentinel changed from
   `'https://www.paypal.com/checkout'` → `'stripe'`. That flips them onto the Stripe path
   (`/api/create-checkout-session`, price resolved from Supabase by slug). The PayPal branch
   (`if (isPayPalOnly)`) now never fires — no cart is a PayPal cart anymore.
2. **Backend safety net** — `functions/api/create-paypal-order.js`: first line of `onRequestPost`
   now returns `410 "PayPal checkout has been removed"`. Even a stale cached page cannot create a
   PayPal order. Reversible: delete that one block.

**VERIFIED:** `node tools/check-prices.mjs` (2026-07-10) → all 11 services-page items have
displayed price == charged price; the 3 live Website Fixes ($99/$199/$349) resolve correctly and
are published. The reroute charges the same amounts PayPal did.
**Final proof still owner-only:** one Stripe **test-mode** purchase of a Website Fix on the deployed
site (needs the Stripe account; Claude does not handle payment credentials).

**Cosmetic sweep — DONE (2026-07-10):** the dead `isPayPalOnly` checkout branch in `services.js`
(its user-facing "PayPal" strings + the `/api/create-paypal-order` call + the mixed-cart guards) was
removed, and every stale "PayPal" comment/label in `services.js`, `purchase-complete.js`, and the
`docs/*.html` service pages + `purchase-complete.html` was reworded to Stripe/checkout. Verified:
`node --check` passes on both scripts; `grep -i paypal docs/` now returns ONLY the intentional
removal-record comments. Not touched: `supabase/referral.sql` (a DB reference, not user-facing).

**Reverse the whole change:** restore `pay:'https://www.paypal.com/checkout'` on the three items in
`services.js` and delete the `410` block in `create-paypal-order.js`. The reasons above still stand.

See **[PAYMENTS-BLUEPRINT.md](PAYMENTS-BLUEPRINT.md)** for the full modular/scalable payment design
and the verifier.
