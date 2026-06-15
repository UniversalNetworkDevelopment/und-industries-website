# U.N.D Industries: Website Services Fulfillment SOP

This document defines the exact standard operating procedure (SOP) that **Qwep** (the autonomous agent) MUST follow when fulfilling incoming service tickets.

---

## 1. Trigger & Intake Bridge (All Services)
1. **Trigger:** The `ticket-relay.js` sidecar detects a ticket in `service_tickets` moving from `pending` to `paid`. It pushes the event to Qwep.
2. **Claim:** Qwep logs the ticket locally in QwepStore and updates Supabase `status = 'intake_pending'`.
3. **Intake Dispatch:** Qwep emails the client an intake link requesting:
   - Specific URLs and issue descriptions.
   - Secure access credentials (via encrypted portal) or Collaborator invites.
4. **Validation:** Once intake data is received and validated, Qwep moves the job to `in_progress`.

---

## 2. Fulfillment Workflows by Service Package

### A. Web Systems

**Quick Fix (`quick`)**
- **Goal:** Resolve a single specific error.
- **Process:**
  1. Clone target repo or access hosting panel (read-only logs).
  2. Snapshot the `before` state of the affected file.
  3. Replicate the error locally or via browser subagent.
  4. Apply the minimal necessary code fix in a new branch/draft state.
  5. Test functionality.
  6. Snapshot the `after` state.

**Fix Bundle (`bundle`)**
- **Process:**
  1. Complete Quick Fix steps for up to 3 issues.
  2. Run Lighthouse via browser subagent; record performance scores.
  3. Apply caching/minification fixes if performance is degraded.
  4. Run mobile responsive tests across 3 breakpoints.

**Full Cleanup (`cleanup`)**
- **Process:**
  1. Complete Fix Bundle steps.
  2. Test all contact forms end-to-end to ensure mail delivery.
  3. Scan DOM for missing `<meta>` descriptions, `<h1>` tags, and `alt` text. Inject compliant SEO tags.
  4. Snapshot the final consolidated PR before merge.

### B. Shopify & Commerce

**Shopify Quick Cleanup (`shopify_quick`)**
- **Process:**
  1. Accept Shopify Collaborator request.
  2. Duplicate the live theme as `[UND-Backup] Live Theme`.
  3. Work entirely inside a new draft theme `[UND-Work] Quick Cleanup`.
  4. Fix reported layout bugs via Liquid/CSS edits.
  5. Verify mobile layout on product/collection pages.

**Shopify Professionalization (`shopify_pro`)**
- **Process:**
  1. Complete Quick Cleanup steps (using draft themes).
  2. Restructure the Homepage (Hero banner, trust badges, featured collections).
  3. Verify Search behavior and standardize product tagging schema.

**Dropshipping Integration (`shopify_drop`)**
- **Process:**
  1. Install requested dropshipping app (e.g. Zendrop).
  2. Configure API bridging and shipping profiles.
  3. Execute a test order via Shopify Bogus Gateway to ensure webhook fulfillment works.

**Full Shopify Build (`shopify_build`)**
- **Process:**
  1. Scaffold base theme based on tier (Starter/Standard/Premium).
  2. Import catalog CSVs.
  3. Build required static pages (Terms, Privacy, About, Contact).
  4. Configure navigation menus and footer structure.

### C. Automation & AI

**Starter Automation (`auto_start`)**
- **Process:**
  1. Access Make.com/Zapier via secure intake keys.
  2. Build 1–2 requested webhook/trigger flows.
  3. Test the trigger 3 times to ensure a 100% success rate.
  4. Snapshot the JSON representation of the workflow.

**Advanced Automation (`auto_adv`)**
- **Process:**
  1. Map the multi-step data architecture.
  2. Build conditional routing, error handling, and data transformation scripts.
  3. Integrate payment gateways or external API endpoints.
  4. Generate an architecture map (Mermaid) for the client.

---

## 3. Testing, Completion, and Evidence

1. **Testing:** Qwep must verify the fix natively or via a browser subagent.
2. **Completion Report:** Qwep generates a final summary including:
   - Summary of actions taken.
   - Before & After screenshots / code diffs.
   - Reminder to revoke access.
3. **Database Update:** Update `service_tickets.status = 'completed'` in Supabase.
4. **Cleanup:** Delete the local cloned repository and purge decrypted credentials from memory.

---

## 4. Failure Handling

- **Access Failed:** If intake is incomplete after 7 days, update status to `failed_access`.
- **Unexpected Crash:** Run `git reset --hard` (or discard draft theme), update status to `failed`, log stack trace, and alert Owner.
