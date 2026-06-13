# Site Consistency Standard & Audit

The site is static HTML (one file per page, no build step / no shared includes), so
the `<head>` and nav are hand-copied per page and **drift over time**. This doc records
the drift found on 2026-06-13, the fixes applied, and the canonical standard every page
must match so it doesn't happen again.

## Audit — 2026-06-13 (issues found)

| Issue | Symptom | Root cause |
|-------|---------|------------|
| **Favicon inconsistent** | Some tabs showed the silver UND emblem, others a purple "U" | Every page linked `favicon.svg`; 3 pages (store, services, purchase-complete) *also* linked `favicon.png` (a different purple-U icon), so the browser showed the PNG on those pages only. |
| **Services link missing** | `Services` appeared in the nav only on `index` + `services`; absent on every other page (store, about, music, etc.) | The link was added to two pages only; never propagated. |
| **Auth state "doesn't track"** | Felt like login didn't carry across pages | Mostly perceptual — driven by the two drifts above. `main.js` *does* swap `.nav-cta` → "Dashboard" on every page that has main.js + a `.nav-cta` (all public pages). See note below. |

## Fixes applied (2026-06-13)

- **One favicon, everywhere.** `favicon.svg` is now the **UND emblem on a dark rounded
  app-tile** (the chosen mark). Every page links exactly:
  `<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">` — placed right after
  the stylesheet link. **All `favicon.png` (purple-U) references were removed.** The PNG
  file is left in `assets/` unused (not deleted).
  - Visual-QA'd at 16/24/32/48/64/128px (dark + light tab) before shipping.
- **Services in nav + footer on every public page.** Inserted after the `About` item in
  both the top nav and the footer "Pages" list.

## Canonical standard (match this on EVERY new/edited page)

**`<head>` icon (exactly one line, after the stylesheet link):**
```html
<link rel="stylesheet" href="assets/css/styles.css">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
```

**Top nav links order:** Home · About · Services · Store · Music · Contact
(then the two `.nav-mobile-auth` items). The current page's link gets
`class="active" aria-current="page"`.

**Auth in the nav is JS-driven — do NOT hardcode it differently per page.** Keep the
static `.nav-cta` (Login + Sign Up buttons) and the two `.nav-mobile-auth` `<li>`s exactly
as on other pages; `main.js > updateNavAuth()` rewrites them to "Dashboard" / "Sign Out"
when a session exists. A page missing `.nav-cta` (e.g. `login`, `register`, `dashboard`,
`404`) intentionally has no Login/Sign-Up buttons.

> Note on the "logged-in flash": because the static HTML ships the logged-out buttons and
> `main.js` swaps them after `getSession()` resolves, there is a brief logged-out flash on
> each navigation. If we want to kill it, gate `.nav-cta` visibility until auth resolves
> (left as a future polish item — not a correctness bug).

## Utility for re-checking drift
Run from `docs/` to see which pages deviate:
```
# pages still referencing the old purple-U png (should be 0):
Select-String *.html -Pattern 'favicon\.png' -SimpleMatch
# pages with the Services link (should be all public pages):
Select-String *.html -Pattern 'href="services.html"' -SimpleMatch
```
