# U.N.D Industries: Website Services Fulfillment SOP

This document defines the exact standard operating procedure (SOP) that **Qwep** (the autonomous agent) MUST follow when fulfilling incoming service tickets. 

**Zero-Egress Mandate:** Qwep operates locally. All tickets are pushed to Qwep via the `ticket-relay.js` sidecar.

---

## 1. Initial Intake (All Services)

When a new ticket arrives with `status = 'paid'`, Qwep must:
1. Identify the `service_slug` and `ticket_number`.
2. Generate an **Intake Email** to the customer containing:
   - Order confirmation and ticket number.
   - The specific deliverables for their package.
   - A secure request for any necessary credentials (e.g., Shopify collaborator access, WordPress admin login, cPanel/FTP details).
3. Wait for the customer to provide access. **Do not begin work until access is verified.**

---

## 2. Fulfillment Workflows by Service Package

### A. Website Fixes
**Quick Fix (`quick`)**
- **Goal:** Resolve a single specific error.
- **Process:**
  1. Replicate the error described by the user (use browser subagent or local fetch).
  2. Identify the root cause (CSS glitch, broken JS, 404 link).
  3. Apply the minimal necessary fix.
  4. Visual QA: Take a "Before" and "After" screenshot of the fixed element.

**Fix Bundle (`bundle`)**
- **Goal:** Resolve up to 3 issues + speed/mobile check.
- **Process:**
  1. Complete Quick Fix steps for the reported issues.
  2. Run a mobile responsiveness audit via browser subagent.
  3. Run a basic Lighthouse speed test and fix any glaring issues (unoptimized images, render-blocking scripts).

**Full Cleanup (`cleanup`)**
- **Goal:** Complete overhaul of speed, mobile, SEO, and forms.
- **Process:**
  1. Complete Fix Bundle steps.
  2. Test all contact forms end-to-end to ensure they deliver mail.
  3. Add missing `<meta>` descriptions, `<h1>` tags, and `alt` text to images.
  4. Aggressively minify CSS/JS and compress images.

---

### B. Shopify Services
**Shopify Quick Cleanup (`shopify_quick`)**
- **Goal:** Theme cleanup and layout fixes.
- **Process:**
  1. Log into Shopify via Collaborator account.
  2. Fix reported theme layout bugs (liquid/CSS edits).
  3. Check mobile layout across product and collection pages.

**Shopify Professionalization (`shopify_pro`)**
- **Goal:** Agency-level storefront polish.
- **Process:**
  1. Complete Quick Cleanup steps.
  2. Rebuild the Homepage layout for better conversion (hero banners, social proof).
  3. Standardize product tags and configure the search bar/filters.

**Dropshipping Integration (`shopify_drop`)**
- **Goal:** Supplier setup and automation.
- **Process:**
  1. Install and configure the requested dropshipping app (DSers, Zendrop, etc.).
  2. Sync the initial catalog and map shipping profiles.
  3. Place a test order to ensure the fulfillment automation triggers correctly.

---

### C. Automation & AI
**Starter Automation (`auto_start`)**
- **Goal:** 1-2 basic workflows.
- **Process:**
  1. Connect requested platforms (e.g., Make.com, Zapier, or custom Node script).
  2. Build a webhook or trigger-based flow (e.g., Lead form -> Google Sheet -> Email).
  3. Test the trigger 3 times to ensure 100% success rate.

**Advanced Automation (`auto_adv`)**
- **Goal:** Complex, multi-step business logic.
- **Process:**
  1. Map the data architecture.
  2. Build conditional routing, error handling, and data transformation steps.
  3. Integrate payment gateways or API endpoints if required.
  4. Provide the customer with a visual map of the data flow.

---

## 3. Delivery & Handover

Once the technical work is complete, Qwep must:
1. Verify the fix in a production environment (Visual QA).
2. Generate a **Completion Report** containing:
   - Summary of actions taken.
   - Before & After screenshots.
   - Any new documentation or passwords generated.
3. Update the ticket status in Supabase to `completed`.
4. Close the session.
