# U.N.D Website — Code Audit & Map (2026-07-10)

Static code audit of `docs/` (frontend) and `functions/` (backend). No browser needed —
every finding is from the code itself. **Regenerate anytime:**
- `node tools/audit-site.mjs` — frontend map + consistency + code-level visual bugs
- `node tools/check-prices.mjs` — displayed price == charged price (see PAYMENTS-BLUEPRINT.md)

---

## Update 2026-07-10 — shared chrome + unstyled-class fixes

The nav + footer now come from **`partials/nav.html` + `partials/footer.html`**, injected into all 19
marketing/legal pages by **`build.mjs`**. Re-audit confirms **nav + footer drift = 0** across those
pages (was ~11 drifted). Active-state is set at runtime in `main.js` by filename (CSS `.nav-links
a.active`). `update_nav.js` is deprecated. **To change the nav/footer:** edit a partial → run
`node build.mjs` → commit. Never hand-edit one page's chrome again.
**Also fixed (L1 — real unstyled classes):** added CSS for `.sr-only` (it was rendering a visible
"Search products" label on store.html), `.text-muted`, `.btn-ghost`, `.tickets-grid`, `.loading-spinner`.
The 7 classes still flagged are harmless — modifiers on styled bases, JS hooks, or external
(`.notfound-legal`, `.sidebar-tab-btn`, `.featured-release-embed`, `.store-content`, `.hero-trust`,
`.hero-delay-5`, Cloudflare's `.cf-turnstile`).

**Remaining (needs a decision or is a bigger task):** `dashboard.html`'s `dashboard-alt.html`
("Studio Panel") dead link — build it or remove it (your call); the `music.html` fan-page leftover
(keep/remove); the 3-page duplicated inline CSS (H3); the `main.js` monolith (M2); repo/util tidy (L3/B1).

## Verdict (one line each)

| Dimension | Backend (`functions/`) | Frontend (`docs/`) |
|---|---|---|
| **Modular** | Yes — clean `api/` + `util/` split | **No** — page chrome copy-pasted into 20 files; 135 KB `main.js` monolith |
| **Scalable** | Yes — add a route/product, one path | Payments yes; **pages/content no** — duplication tax |
| **Clean** | Mostly — `util/` has one-off scripts mixed in | **Not yet** — inline + duplicated CSS, drift, fan-page leftover |

The architecture is sound. This is cleanup and consolidation, **not a rewrite**. The single
root cause of most frontend issues is: **there is no shared header/footer/component system**, so
every page is hand-maintained and they have drifted apart.

---

## Site map (27 HTML files)

- **20 corporate pages** — load `main.js` + `styles.css` + `nav` + `footer`
  (index, about, services, shopify, automation, store, contact, customer-service, dashboard,
  service-intake, purchase-complete, refund, terms, privacy, cookie, copyright, disclaimer,
  dmca, security, **music**).
- **5 auth/utility pages** — `main.js` + `styles.css`, no nav/footer by design
  (login, register, reset-password, verified, 404).
- **1 standalone page** — `maintenance.html`: self-contained (its own inline CSS + colors, loads
  no external assets). **This is correct** — a maintenance page must render even if assets fail.
- **1 non-page** — `googled52eaa6de2b08dd8.html`: Google Search Console verification token. Expected.

---

## Findings (verified, by severity)

### HIGH

**H1 — Footer is inconsistent across pages (drift).**
~11 of 20 corporate pages have a different footer. There are roughly two variants: a "full"
16-link footer and a reduced one. Concrete drift:
- `dashboard.html` — missing ~15 footer links (nearly empty footer)
- `service-intake.html` — missing 11
- `services.html`, `shopify.html`, `automation.html` — each missing 7 legal links
  (about, cookie, copyright, disclaimer, dmca, music, security) and each has **extra** `store.html`, `login.html`
- `contact`, `store`, `music`, `purchase-complete`, `index` — smaller diffs
A visitor sees different footer links depending on the page. Cause: no shared footer; hand-edited per page.

**H2 — Broken nav link + nav drift on the dashboard.**
`dashboard.html` nav points to **`dashboard-alt.html`, which does not exist** (dead link), and its
nav is missing 6 of the canonical 10 links. `service-intake.html` nav is missing `music.html`.
The other 18 pages share an identical nav.

**H3 — The same big CSS block is duplicated inline in 3 pages.**
`services.html`, `shopify.html`, `automation.html` each carry a copy of the same ~100-line inline
`<style>` (e.g. `.svc-card`, `.cart-panel`, `.cart-overlay`, all identical at line 21/70). Fix a
card or cart style → you must fix it in **3 places** or they drift. This is why ~48 inline
`style="…"` and 8 inline `<style>` blocks exist site-wide.

### MEDIUM

**M1 — No shared component system (the root cause of H1/H2).**
`<nav>` is duplicated in 20 files, `<footer>` in 20 files. `update_nav.js` at the repo root is a
hand-rolled string-replace script that "syncs" the nav — but it only ever performed one specific
change (Services→dropdown) and matches literal text, so it silently skips any page whose markup
drifted. This is fragile and is why the pages fell out of sync.

**M2 — `main.js` is a 135 KB monolith.**
271 functions in one IIFE, loaded by all 25 real pages (even 404 and legal pages), with logic
gated by "does this element exist." One syntax error anywhere breaks every page. (Caching limits
the perf cost; maintainability is the real cost.)

### LOW

**L1 — Genuinely unstyled classes (small visual bugs).** Used in HTML, defined in no CSS (external
or inline): `.sr-only` (⚠ if used, screen-reader-only text renders *visible*), `.text-muted`,
`.btn-ghost`, `.loading-spinner`, `.tickets-grid`, `.sidebar-tab-btn`, `.hero-trust`,
`.hero-delay-5`, `.store-content`, `.featured-release-embed`, `.notfound-legal`. (`.cf-turnstile`
is Cloudflare's own class — fine.) Each is either a typo, a leftover, or a missing rule.

**L2 — Fan-page leftover.** `music.html` is still a full corporate page wired into the canonical
nav and footer. Decide: keep, archive, or remove (removal also touches the shared nav/footer).

**L3 — Repo clutter.** ~40 loose `.md` files at root (many are 0.4 KB `*_MISSING.md` / `*_QA_REPORT.md`
stubs; plus a 73 KB `MASTERPLAN.md`) and loose one-off scripts (`update_nav.js`, `cache_bust.js`,
`insert_test.js`). Hard to tell what is current.

---

## Verified NON-issues (checked, and they're fine)

- **CSS variables:** no real bugs. `--font-mono` has a `, monospace` fallback; `--purple/--green/--purple-glow`
  are defined inline in the self-contained `maintenance.html`.
- **Assets:** every referenced `/assets/*` file exists. No broken img/css/js.
- **Duplicate IDs:** none. **`<img>` alt text:** all present. **Head essentials** (charset/viewport/title): all real pages pass.
- **JS syntax:** all 7 frontend scripts pass `node --check`. No syntax-level programming errors.

---

## Backend (`functions/`) assessment

Structurally the **cleaner half**: `api/` = one file per route (create-checkout-session, stripe-webhook,
create-portal-session, contact, …); `util/` = shared helpers (cors, supabase, stripe, license). The
payments core is already reviewed and documented (PAYMENTS-BLUEPRINT.md) and is genuinely modular.

Issues:
- **B1 — `util/` mixes runtime helpers with one-off scripts.** `update_services.js`, `update_dashboard.js`,
  `update_dedicated.js`, `update_css.js`, `seed_products.js` are throwaway maintenance scripts sitting
  next to real dependencies (`cors.js`, `supabase.js`, `stripe.js`). Move them to `scripts/`.
- **B2 — Dead-but-intentional:** `paypal.js`, `create-paypal-order.js`, `paypal-webhook.js` are disabled
  and reversible on purpose (see PAYMENTS-DECISION-remove-paypal.md). Fine to leave; documented.
- **Recommended:** a dedicated per-endpoint logic audit (error handling, auth, edge cases) as its own
  focused pass — it's income code and deserves more than a structural skim.

---

## Fix plan (priority order, each a self-contained chunk)

1. **Shared header + footer** (partials + a tiny build step) → fixes H1, H2, M1 at once and retires
   `update_nav.js`. Biggest single win; makes the site modular.
2. **Consolidate the duplicated inline CSS** (H3) into `styles.css` (`.svc-*`, `.cart-*`) → one source
   of truth for the services/shopify/automation styling; removes the 3-way copy.
3. **Fix the small stuff** — remove the `dashboard-alt.html` dead link (H2), add/define the ~11 unstyled
   classes (L1), decide on `music.html` (L2).
4. **Repo + `util/` hygiene** (L3, B1) — archive doc stubs, move one-off scripts to `scripts/`.
5. **Later:** split `main.js` into page-scoped modules (M2); dedicated backend logic audit.
