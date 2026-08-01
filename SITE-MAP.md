# SITE MAP — what universalnetworkdevelopment.com actually has

**GENERATED — do not hand-edit.** `node tools/site-inventory.mjs`
Generated: 2026-08-01 00:57 · 29 pages · 9 scripts

> Written because the same mistake happened three times in one day: rebuilding a picture of
> this site by grep and getting it wrong. A grep of the source cannot tell you whether a
> feature is REACHABLE, and it cannot see anything rendered at runtime.

## HOW THIS RELATES TO MASTERPLAN.md — read this before using either

There are two documents describing this site and they have **different jobs**. Confusing them
is how you end up trusting the wrong one.

| | **SITE-MAP.md** (this file) | **MASTERPLAN.md** |
|---|---|---|
| What it is | GENERATED facts | HAND-WRITTEN intent + planning |
| Answers | what EXISTS and whether it is REACHABLE | what it is FOR and where it is going |
| Freshness | regenerate any time; cannot rot | **content dated 2026-05-19 — check before trusting** |
| Git | tracked | **gitignored, PRIVATE / trade secret — never commit** |

**Neither replaces the other.** This file cannot tell you why a thing exists; MASTERPLAN
cannot tell you whether it still works. **On any question of current fact, THIS file wins** —
it was generated from the code, MASTERPLAN was written by a human months ago and still says
"Impl Status: COMPLETE - all critical/high/medium gaps resolved", which was already false when
the cart broke four weeks later and stayed broken for six.

## ⚠ CLIENT-RENDERED PAGES — SOURCE INSPECTION IS NOT SUFFICIENT

These pages build their content at runtime from Supabase. `curl`, `grep` and "view source"
**will show an empty page and that means nothing.** To know what is on them you must load
them in a real browser. On 2026-07-31 store.html was reported as an empty filter UI on this
exact basis; it actually renders **15 products**.

- **automation.html** — Automation & AI &mdash; Work Smarter | U.N.D Industries
- **shopify.html** — Shopify Services &mdash; Built for Growth | U.N.D Industries

## THE BUY SURFACE — which pages can take money

| Page | data-pay | Add to Cart | Coming Soon | cart panel | forms |
|---|---|---|---|---|---|
| automation.html | 0 | 1 | 4 | yes | 0 |
| services.html | 11 | 1 | 11 | yes | 0 |
| shopify.html | 0 | 1 | 1 | yes | 0 |

**Note:** "Coming Soon" in the static HTML is the FAIL-CLOSED default. Every buy button ships
disabled and JavaScript only ever UNLOCKS, based on `store_products.availability` in Supabase.
So a Coming Soon count here does NOT mean the service is unavailable to a real visitor.

## DEAD WIRING — handlers bound to elements that do not exist

**1 binding(s) match ZERO elements.** The handler can never fire,
so the feature is unreachable no matter how complete the code looks.

| Script | Binds to | Kind | Pages that load it |
|---|---|---|---|
| services.js | `data-quote` | attr | services.html |

## EVERY PAGE

### 404.html
- **Title:** 404 &mdash; Page Not Found | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### about.html
- **Title:** About | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### automation.html
- **Title:** Automation & AI &mdash; Work Smarter | U.N.D Industries
- **Scripts:** site-state.js, main.js, services.js
- **External:** cdn.jsdelivr.net
- **⚠ CLIENT-RENDERED** — you cannot tell what is on this page from the source.

### contact.html
- **Title:** Contact | U.N.D Industries
- **Scripts:** site-state.js, main.js
- **External:** cdn.jsdelivr.net

### cookie.html
- **Title:** Cookie Policy | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### copyright.html
- **Title:** Copyright Notice | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### customer-service.html
- **Title:** Customer Service | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### dashboard-alt.html
- **Title:** Studio Panel &mdash; U.N.D Industries

### dashboard.html
- **Title:** Dashboard &mdash; U.N.D Industries
- **Scripts:** site-state.js, main.js, dashboard.js
- **External:** cdn.jsdelivr.net

### disclaimer.html
- **Title:** Disclaimer | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### dmca.html
- **Title:** DMCA Policy | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### googled52eaa6de2b08dd8.html
- **Title:** (no title)

### index.html
- **Title:** U.N.D Industries &mdash; Creative Technology
- **Scripts:** auth-redirect.js, site-state.js, main.js
- **External:** cdn.jsdelivr.net

### login.html
- **Title:** Sign In &mdash; U.N.D Industries
- **Scripts:** main.js
- **External:** challenges.cloudflare.com, cdn.jsdelivr.net

### maintenance.html
- **Title:** Maintenance &mdash; U.N.D Industries

### music.html
- **Title:** Music | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### privacy.html
- **Title:** Privacy Policy | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### purchase-complete.html
- **Title:** Order Confirmed &mdash; U.N.D Industries
- **Scripts:** site-state.js, main.js, purchase-complete.js, feedback.js
- **External:** cdn.jsdelivr.net

### refund.html
- **Title:** Refund &amp; Returns Policy | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### register.html
- **Title:** Create Account &mdash; U.N.D Industries
- **Scripts:** main.js
- **External:** challenges.cloudflare.com, cdn.jsdelivr.net

### reset-password.html
- **Title:** Reset Password &mdash; U.N.D Industries
- **Scripts:** main.js
- **External:** challenges.cloudflare.com, cdn.jsdelivr.net

### review-thanks.html
- **Title:** Thanks for the feedback | UND Industries
- **Scripts:** review-thanks.js

### security.html
- **Title:** Security Disclaimer | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### service-intake.html
- **Title:** Order Details &mdash; U.N.D Industries
- **Scripts:** site-state.js, main.js, service-intake.js
- **External:** cdn.jsdelivr.net

### services.html
- **Title:** Services &mdash; Website Fixes & AI Development | U.N.D Industries
- **Scripts:** site-state.js, main.js, services.js
- **External:** cdn.jsdelivr.net

### shopify.html
- **Title:** Shopify Services &mdash; Built for Growth | U.N.D Industries
- **Scripts:** site-state.js, main.js, services.js
- **External:** cdn.jsdelivr.net
- **⚠ CLIENT-RENDERED** — you cannot tell what is on this page from the source.

### store.html
- **Title:** Store &mdash; U.N.D Industries
- **Scripts:** site-state.js, main.js
- **External:** cdn.jsdelivr.net

### terms.html
- **Title:** Terms of Use | U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net

### verified.html
- **Title:** Email Verified &mdash; U.N.D Industries
- **Scripts:** main.js
- **External:** cdn.jsdelivr.net
