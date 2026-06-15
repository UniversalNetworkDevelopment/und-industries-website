# U.N.D Industries: Website Services Fulfillment SOP

This is the exhaustive Standard Operating Procedure (SOP) for **Qwep** to fulfill all 10 paid services, plus the strict Owner Test Mode workflow. Zero deviations are permitted.

---

## 0. OWNER TEST MODE: GITHUB TEST WEBSITE BUILDER
- **Trigger:** Job moves to `in_progress` with `ticket_type = 'test'`.
- **Intake Provided:** Test repository name, design motif (e.g., "slashy, modern, animated").
- **Fulfillment Steps:**
  1. Authenticate with GitHub API using internal test PAT.
  2. Create a new public repository.
  3. Scaffold a modern HTML/CSS/JS frontend utilizing glassmorphism, dynamic scrolling, and "slashy" neon aesthetics.
  4. Query Gemini to generate dynamic copy and micro-animations for the test site.
  5. Commit all code to the repository.
  6. Enable GitHub Pages to deploy the site live.
- **Testing:** Verify the GitHub Pages URL returns HTTP 200 and loads successfully.
- **Completion:** Generate Evidence Pack containing the Repo URL, Live URL, and a screenshot of the deployed site. Move to `awaiting_review`.
- **Failure:** If GitHub API limits are hit, mark `failed_access`. Rollback by deleting the repo.

---

## 1. WEBSITE QUICK FIX
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Site URL, exact bug description, GitHub/Panel access.
- **Fulfillment Steps:**
  1. Clone repository to isolated `/tmp/jobs/{ticket_id}` sandbox.
  2. Snapshot current state.
  3. Replicate bug using browser subagent.
  4. Query Gemini/Qwen to identify the minimal CSS/JS/HTML fix.
  5. Apply fix on a new branch `fix/{ticket_id}`.
- **Testing:** Browser subagent verifies the form submits, link works, or layout is fixed. Checks mobile viewport.
- **Completion:** Generate Change Summary. Merge branch. Move to `awaiting_review` and email client.
- **Failure:** If bug is unfixable without rewriting the app, roll back, mark `needs_manual_review`.

## 2. FIX BUNDLE
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Up to 3 issues, Site URL, constraints.
- **Fulfillment Steps:**
  1. Clone repo and snapshot.
  2. Execute Quick Fix loop for all 3 issues sequentially.
  3. Run Lighthouse performance check.
- **Testing:** Verify all 3 fixes independently. Verify site speed hasn't degraded.
- **Completion:** Generate combined Evidence Pack. Move to `awaiting_review`.
- **Failure:** If 1 issue is unfixable, finish the other 2, document the failure, mark `needs_manual_review`.

## 3. FULL CLEANUP
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Site URL, performance/SEO concerns.
- **Fulfillment Steps:**
  1. Complete Fix Bundle workflow.
  2. Optimize Core Web Vitals (minify assets, lazy-load images).
  3. Scan DOM for missing `<meta>` descriptions, `<h1>` tags, and `alt` attributes. Inject SEO improvements.
  4. Test all contact forms to ensure mail delivery.
- **Testing:** Lighthouse score must improve. Form submission must return 200 OK.
- **Completion:** Present Before/After Lighthouse scores. Move to `awaiting_review`.
- **Failure:** If CMS blocks optimizations, generate report explaining limitations, mark `completed`.

---

## 4. SHOPIFY QUICK CLEANUP
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Store URL, Collaborator access.
- **Fulfillment Steps:**
  1. Accept Collaborator request.
  2. Duplicate live theme as `[UND-Backup] Live`.
  3. Create working theme `[UND-Work] Quick Cleanup`.
  4. Resolve theme clutter and mobile layout bugs via Liquid/CSS in the working theme.
- **Testing:** Emulate mobile devices to verify layout.
- **Completion:** Publish `[UND-Work]` theme to live. Move to `awaiting_review`.
- **Failure:** If theme is hard-coded/broken, discard working theme, mark `needs_manual_review`.

## 5. SHOPIFY PROFESSIONALIZATION
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Store URL, Homepage goals, product tagging needs.
- **Fulfillment Steps:**
  1. Backup live theme.
  2. Restructure Homepage liquid templates (Hero banner, trust badges).
  3. Bulk update product tags based on schema requirements via Shopify Admin API.
  4. Tune search/filtering behavior.
- **Testing:** Visual QA of Homepage. Ensure search returns correct tagged products.
- **Completion:** Publish theme. Move to `awaiting_review`.
- **Failure:** Discard draft theme, rollback tags via API if failure occurs midway.

## 6. DROPSHIPPING INTEGRATION
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Store URL, Supplier platform (e.g., Zendrop).
- **Fulfillment Steps:**
  1. Install requested supplier app.
  2. Map shipping profiles and sync initial catalog.
  3. Configure auto-fulfillment settings in app.
- **Testing:** Place a test order via Bogus Gateway to verify webhook triggers to supplier.
- **Completion:** Send video/screenshot evidence of test order flow. Move to `awaiting_review`.
- **Failure:** Uninstall app, clear bogus orders, mark `failed`.

## 7. FULL SHOPIFY BUILD (STARTER / STANDARD / PREMIUM)
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Niche, catalog, design preferences, tier.
- **Fulfillment Steps:**
  1. Scaffold theme based on Tier.
  2. Import catalog CSVs.
  3. Generate Terms, Privacy, About, Contact pages.
  4. Configure navigation and footer.
- **Testing:** Verify all links, cart flow, and policy pages.
- **Completion:** Transfer store ownership / provide completion pack. Move to `awaiting_review`.
- **Failure:** Mark `needs_manual_review` if catalog CSV is invalid.

---

## 8. STARTER AUTOMATION
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Apps involved, 1-2 workflows, API keys.
- **Fulfillment Steps:**
  1. Export current Make/Zapier state if existing.
  2. Construct webhook/trigger logic.
  3. Map data fields between the two apps.
- **Testing:** Fire 3 test payloads. Require 100% success rate (HTTP 200/201).
- **Completion:** Provide JSON blueprint and screenshot of successful execution. Move to `awaiting_review`.
- **Failure:** If API keys are invalid, mark `failed_access`.

## 9. ADVANCED AUTOMATION
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** Multi-step workflows, payment automation logic.
- **Fulfillment Steps:**
  1. Construct complex logic (routing, error handling).
  2. Integrate Stripe/Payment webhooks if requested.
  3. Build data transformation layers using Gemini.
- **Testing:** Fire test payloads simulating edge cases (missing data, failed payments).
- **Completion:** Export JSON blueprint, provide Mermaid architecture diagram. Move to `awaiting_review`.
- **Failure:** Rollback to original JSON state if existing.

## 10. ENTERPRISE AUTOMATION
- **Trigger:** Job moves to `in_progress`.
- **Intake Provided:** High-level business logic, chatbot needs.
- **Fulfillment Steps:**
  1. Architect full solution utilizing custom Node microservices or massive Make.com scenarios.
  2. Integrate LLM wrappers if chatbots are required.
  3. Establish robust error logging and retry mechanisms.
- **Testing:** E2E simulation of entire business logic flow.
- **Completion:** Comprehensive documentation, source code handover. Move to `awaiting_review`.
- **Failure:** Halt and mark `needs_manual_review` if external APIs are unsupported.

---

## GLOBAL WRAP-UP (All Services)
When `awaiting_review` is confirmed by client (or auto-approves after 72 hours):
1. Job moves to `completed`.
2. Qwep deletes encrypted credentials from memory.
3. Qwep sends final email: "Your project is complete. Please revoke our collaborator/staff access."
