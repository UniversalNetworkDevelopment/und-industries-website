# RE-ENABLING THE SERVICES BUY BUTTONS — RUNBOOK
**Written 2026-07-19 because this was undocumented and cost 32 days of $0 revenue.**

---

## WHY THEY ARE OFF (the real history, not a guess)

Commit **`60b3e72`, 2026-06-17 12:11:03** — *"coming-soon mode on all service/store pages"*:
> *services.html: all payment buttons disabled, coming-soon CTA, cart hidden*
> *GAP-01 resolved: no live payments while fulfillment backend is not wired*
> *Rule 141 enforced: store frozen until Qwep order intake is live*

**Alex made the call, and it was correct.** At that moment the site could take money
smoothly and then do nothing: no order email, no fulfilment path, no compliance package for
Services, and a no-refunds policy. Taking payment you cannot fulfil, with no refund, is not
a gap — it is the shape of a consumer complaint. Closing the door was right.

**The mistake was not the gate. It was recording it as "resolved" with no written reopen
condition and no owner.** A closed gate is an OPEN loop. It stayed shut for 32 days.

---

## THERE ARE TWO LOCKS. THIS IS WHY "SIMPLE RE-ENABLE" DID NOT WORK.

### Lock A — the designed switch *(documented in `PAYMENTS-BLUEPRINT.md`)*
`docs/assets/js/services.js`, the `SERVICES` map:
- `pay: 'stripe'` → **live**, routes through `/api/create-checkout-session`
- `pay: 'https://buy.stripe.com/PLACEHOLDER_…'` → renders **"Coming soon"**, non-clickable

**Current state: OPEN for the 3 website-fix services** (`quick`, `bundle`, `cleanup` are
already `pay:'stripe'` locally). This is the lock that was described as "something simple."

### Lock B — the June 17 emergency gate *(was undocumented — the actual blocker)*
`docs/services.html` — the `<a data-pay="…">Add to Cart</a>` elements were **deleted** and
replaced with:
```html
<button class="btn-cs" disabled>🔒 Coming Soon</button>
<a class="btn-cs-contact" href="contact.html">✉ Inquire Now</a>
```
**Verified live 2026-07-19: ZERO `data-pay` attributes exist in the page DOM.**
`services.js` binds to `[data-pay]`, so with Lock B closed the entire booking + consent +
Stripe flow is dead code with nothing to attach to. **Lock A is irrelevant while Lock B is shut.**

---

## THE REOPEN CONDITION — do not flip this until ALL are true

The original reason was *"no live payments while fulfillment backend is not wired."*
**That reasoning still holds.** Opening the door before fulfilment is worse than staying
closed, because then money is taken and nobody is told.

- [ ] **Owner is notified when payment lands.** Today: `db_schema/02_triggers.sql:20` posts to
      `http://127.0.0.1:3133` — that is *Supabase's* loopback, not Alex's PC. Unreachable by
      design, and 3133 is not listening. Must be a server-side send (Cloudflare Worker →
      email), never a tunnel to a home machine.
- [ ] **Customer receives a confirmation with their intake link.** Today there is **no email
      anywhere in the codebase** (0 hits for `sendmail|nodemailer|resend|sendgrid|mailgun|smtp`).
- [ ] **A work order exists and is trackable** — ticket flips `checkout_started → paid` and
      someone sees it.
- [ ] **Services compliance is live** — MSA v0.2 reviewed, published, and presented at
      checkout for Service orders (versioned in `policy_acceptance_logs`), plus the three
      `terms.html` / `refund.html` edits.
- [ ] **One end-to-end Stripe TEST-mode transaction has completed** — through to a
      `purchases` row and a ticket at `paid`. As of 2026-07-19: `purchases` = **0 rows, $0.00**.
      The flow has never completed once, even in testing.

**Owner of this gate: Alex.** Nobody else opens it.

---

## HOW TO OPEN IT (once the checklist above is green)

### Step 1 — restore the buy buttons (Lock B)
The exact original markup is recoverable:
```
git show 60b3e72 -- docs/services.html
```
The removed lines look like:
```html
<a class="btn btn-outline btn-full svc-paybtn" data-pay="quick"   href="contact.html">Add to Cart</a>
<a class="btn btn-primary btn-full svc-paybtn" data-pay="bundle"  href="contact.html">Add to Cart</a>
<a class="btn btn-outline btn-full svc-paybtn" data-pay="cleanup" href="contact.html">Add to Cart</a>
```
**Restore ONLY the three that are genuinely live** — `quick`, `bundle`, `cleanup`. Leave the
other 7 as `<button class="btn-cs" disabled>` since their `pay` values are still
`PLACEHOLDER_` and Lock A would render them "Coming soon" anyway. Keep the
`✉ Inquire Now` link on every card either way; it is the only path for the not-yet-live ones.

### Step 2 — deploy `services.js`
**The live file is STALE.** It still contains PayPal URLs for the three website-fix services;
the local file has `pay:'stripe'`. PayPal was removed server-side on 2026-07-10 and
`create-paypal-order.js` returns **410 Gone** — so a restored button on the *currently
deployed* JS would send buyers to a dead PayPal flow. **Deploy the local `services.js` in the
same push, or do not restore the buttons.**

### Step 3 — verify by LOOKING, not by reading source
```js
// in the browser console on the live /services page
[...document.querySelectorAll('[data-pay]')].map(b => ({
  key: b.getAttribute('data-pay'),
  text: b.textContent.trim(),
  disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true'
}))
```
Expect **exactly 3 enabled** buttons. Source-code presence is not proof — on 2026-07-19 the
static HTML looked plausible while the rendered page had zero buy buttons.

### Step 4 — one real test purchase in Stripe TEST mode
Confirm: `purchases` row created · ticket flips to `paid` · owner email arrives ·
customer email arrives with the intake link. **If any of those four fail, close the gate again.**

---

## THE MAINTENANCE SPLASH (already built)
`docs/maintenance.html` exists (12.6 KB) and is **live at `/maintenance`** (HTTP 200).
Use it for downtime so customers see a deliberate message instead of a broken page.

---

## RULE THAT COMES OUT OF THIS
**Any gate that disables revenue gets logged to `E:\Plans\OPEN-LOOPS.md` as OPEN, with the
literal reopen condition and a named owner — never as "resolved."** "GAP-01 resolved" was a
green light over a locked door, and it read as done to everyone who came after.
