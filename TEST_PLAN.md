# U.N.D Industries: Fulfillment Test Plan

This document outlines the rigorous, zero-risk testing protocol that MUST be executed before any real money or live client data is accepted.

## 1. STRIPE TEST MODE PURCHASES (End-to-End Initiation)

**Execution:**
1. Enable Stripe Test Mode globally.
2. Create dummy customer accounts.
3. Process a test purchase for:
   - [ ] Website Quick Fix
   - [ ] Shopify Professionalization
   - [ ] Starter Automation
4. Verify Stripe fires the webhook and Supabase receives the `service_tickets` row with `status = 'paid'`.

## 2. SUPABASE INFRASTRUCTURE CHECKS

**Execution:**
- [ ] Ticket is correctly created in `service_tickets` with correct `amount_cents` and `service_slug`.
- [ ] Status correctly transitions from `pending` -> `paid`.
- [ ] Qwep successfully claims the ticket (status -> `intake_pending`).
- [ ] Qwep's `claimed_by` flag is correctly populated.

## 3. QWEP WORKER CHECKS

**Execution:**
- [ ] Qwep successfully reads the job via WebSocket / polling.
- [ ] Qwep successfully inserts the job into the local `QwepStore` avoiding duplicates (idempotency check).
- [ ] Qwep dispatches the correct Intake Email/Portal Link based on the `service_slug`.
- [ ] Qwep transitions the job to `in_progress` once dummy intake data is submitted.

## 4. NEXUS DASHBOARD CHECKS

**Execution:**
- [ ] Nexus Dashboard correctly displays the new ticket in real-time.
- [ ] Nexus Dashboard updates the status badge to `in_progress`.
- [ ] Nexus Dashboard correctly displays the "Change Summary" when Qwep moves the ticket to `awaiting_review`.

## 5. SECURITY & ISOLATION CHECKS

**Execution:**
- [ ] **Credential Black-Hole:** Inspect Qwep's console logs, Supabase logs, and Nexus logs. The dummy API keys/passwords MUST NOT appear in plaintext anywhere.
- [ ] **Access Revocation:** Complete a job. Verify Qwep successfully deletes the cloned `/tmp` repo and purges the encrypted credentials from the local SQLite store.

## 6. FAILURE SIMULATIONS

**Execution:**
- [ ] **No Access Provided:** Let a ticket sit in `intake_pending`. Manually trigger the 7-day timeout script. Verify status shifts to `failed_access`.
- [ ] **Revoked Access Mid-Job:** Initiate a GitHub clone job. Mid-way, revoke the GitHub token. Verify Qwep catches the auth error, aborts the job, logs the error, and marks `failed_access`.
- [ ] **Broken Repo:** Submit a corrupted Git repository. Verify Qwep halts gracefully, generates a failure explanation, and marks `needs_manual_review`.

## 7. EVIDENCE & LIABILITY CHECKS

**Execution:**
- [ ] **Before/After Snapshots:** Verify the local `E:\Qwep\Snapshots\` folder contains a pristine `before` snapshot of the target system, and an `after` snapshot.
- [ ] **Change Summary Accuracy:** Review the generated Evidence Pack Markdown file. It must accurately reflect only the files touched by Qwep during the test.

**FINAL Gating Rule:** Live Stripe mode can ONLY be toggled on after every single checkbox above passes the test plan without throwing exceptions.
