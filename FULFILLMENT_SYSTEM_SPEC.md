# FULFILLMENT SYSTEM SPECIFICATION
**Version:** 2.1.0 (Airtight Legal & Technical Spec - Nexus Integrated)
**Target Engine:** Qwep (Sovereign Local AI)

## 1. EVENT BRIDGE (Supabase → Qwep)

**Source:** Supabase `service_tickets` table via REST API.
**Trigger:** `status = 'paid'`

**Mechanism:**
- Qwep runs the `ticket-relay.js` daemon, polling Supabase `/rest/v1/service_tickets?status=eq.paid` every 30 seconds.
- Relay pushes payload to `http://127.0.0.1:3133/api/chat`.
- Zero Shared State: Qwep only interacts with Supabase via the relay. It never touches Stripe or Cloudflare.

**QwepStore Internal Schema (`jobs` table in local Postgres/SQLite):**
```sql
CREATE TABLE jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) UNIQUE NOT NULL,
    user_id UUID NOT NULL,
    client_email VARCHAR(255),
    service_type VARCHAR(255) NOT NULL,
    payment_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'intake_pending', 
    -- Status Enum: paid, intake_pending, intake_complete, in_progress, awaiting_review, completed, failed, failed_access, refunded
    intake_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Idempotency & Claiming:**
1. Relay fetches `paid` tickets.
2. Relay attempts an `INSERT` into QwepStore `jobs`.
3. If `ticket_id` already exists, insert is ignored.
4. If successful, Qwep sends a `PATCH` to Supabase updating `status = 'intake_pending'`. This definitively claims the job and prevents double-processing.

---

## 2. CLIENT INTAKE SYSTEM (SCREENS & SCHEMAS)

When status reaches `intake_pending`, Qwep generates a secure portal link for the user. Plain-text passwords in emails are strictly forbidden.

### A. Web Systems (Quick Fix, Fix Bundle, Full Cleanup)
**Intake Rules:** GitHub collaborator invite, or Hosting Panel access.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "site_url": { "type": "string", "format": "uri" },
    "issue_description": { "type": "string", "description": "Specific problem for Fixes, or goals for Cleanup" },
    "access_method": { "enum": ["github", "vercel", "netlify", "cpanel"] },
    "access_confirmed": { "type": "boolean", "description": "Client confirms they sent the invite to the U.N.D dev account" },
    "priority_notes": { "type": "string" },
    "known_constraints": { "type": "string", "description": "e.g., no downtime during 9-5" }
  },
  "required": ["site_url", "issue_description", "access_method", "access_confirmed"]
}
```

### B. Shopify & Commerce (Quick Cleanup, Professionalization, Dropshipping, Full Build)
**Intake Rules:** Shopify Staff Account or Collaborator Access.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "store_url": { "type": "string", "format": "uri" },
    "collaborator_code": { "type": "string" },
    "primary_goals": { "type": "string" },
    "supplier_platforms": { "type": "array", "items": { "type": "string" }, "description": "For dropshipping" },
    "build_tier": { "enum": ["starter", "standard", "premium"], "description": "For full builds" },
    "design_preferences": { "type": "string" }
  },
  "required": ["store_url"]
}
```

### C. Automation & AI (Starter, Advanced, Enterprise)
**Intake Rules:** API keys submitted directly to the secure, encrypted local Qwep portal.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "apps_involved": { "type": "array", "items": { "type": "string" } },
    "workflow_plain_english": { "type": "string" },
    "api_keys_submitted": { "type": "boolean" },
    "payment_automation_reqs": { "type": "string" }
  },
  "required": ["apps_involved", "workflow_plain_english", "api_keys_submitted"]
}
```

**Storage:** Payloads are stored encrypted in `jobs.intake_data`. Once validated, Qwep updates Supabase to `in_progress`.

---

## 3. ACCESS CONTROL, SECURITY, AND SCOPE LIMITS

- **Credentials Encryption:** Stored locally in QwepStore using AES-256-GCM. Decrypted only in memory at runtime. Never passed to LLM context windows (Gemini/Qwen).
- **Scope Limit Enforcement:**
  - Qwep executes code within isolated `/tmp/jobs/{ticket_id}` sandbox containers.
  - Qwep is restricted to modifying the exact repo/theme provided.
  - It cannot modify global billing settings, DNS, or delete structural data unless explicitly commanded in the intake form.
- **Revocation:** Upon `completed`, Qwep purges `/tmp/jobs/{ticket_id}`, wipes credentials from QwepStore, and emails the client a reminder to remove collaborator access.
- **Access Audit Log:**
  - `timestamp`
  - `process_id`
  - `target_system` (e.g., "Shopify API", "GitHub Repo")
  - `action` (e.g., "clone", "commit", "theme_publish")
  - `ticket_id`

---

## 4. LOGGING, AUDIT TRAIL, AND EVIDENCE SYSTEM

To completely insulate U.N.D Industries from legal liability ("You broke my site").

**QwepStore `changes` Table:**
```sql
CREATE TABLE changes (
    change_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id VARCHAR(255) REFERENCES jobs(ticket_id),
    target_system VARCHAR(50), -- website, shopify, automation
    change_type VARCHAR(50), -- file_edit, theme_update, workflow_add
    before_snapshot_ref VARCHAR(500), -- Path to local immutable storage
    after_snapshot_ref VARCHAR(500),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Snapshot Rules:**
- Websites: Full clone of HTML/CSS/JS prior to ANY edit.
- Shopify: Qwep duplicates the live theme and works strictly on `[UND-Work] Ticket {ID}`. The live theme ID is recorded as `before_snapshot_ref`.
- Automation: Make.com/Zapier JSON blueprint exported before and after modifications.

**Evidence Pack Generation:**
Qwep compiles a ZIP containing the before/after snapshots and the Markdown "Change Summary" before moving to `awaiting_review`.

---

## 5. ERROR HANDLING, ROLLBACK, AND REFUNDS

**1. Access Not Provided:**
- If intake is stuck in `intake_pending` for 7 days, Qwep changes status to `failed_access`.
- Automated email sent to client. Policy logic kicks in for refund/credit decision by Owner.

**2. Access Revoked Mid-Job:**
- Qwep detects auth failure, logs to `changes` table.
- Rolls back any pending commits.
- Changes status to `failed_access`. Escalate to Owner.

**3. System Too Broken to Fix:**
- If Qwep determines the architecture is hopelessly corrupted beyond the package scope (e.g., compromised core files).
- Qwep halts, marks status `needs_manual_review`, generates an Explanation Report, and pages Owner.

**4. Unexpected Error / Qwep Crash:**
- Catch-all exception block triggers `git reset --hard` (or discards Shopify draft theme).
- Marks `failed`. Pings Owner dashboard immediately.

---

## 6. OWNER & STAFF DASHBOARDS (REST API SURFACE)

Qwep exposes endpoints for the local dashboard to read job states.

**GET `/api/fulfillment/jobs`**
```json
{
  "jobs": [
    {
      "ticket_id": "TST-9999",
      "service_type": "shopify_professionalization",
      "client": "email@example.com",
      "status": "in_progress",
      "timeline": { "intake_complete": "2026-06-15T14:00:00Z" }
    }
  ]
}
```

**GET `/api/fulfillment/jobs/:ticket_id/evidence`**
```json
{
  "ticket_id": "TST-9999",
  "change_logs": [
    {
      "timestamp": "2026-06-15T14:15:00Z",
      "action": "Updated theme.liquid",
      "before_ref": "/snapshots/TST-9999/before_theme.liquid",
      "after_ref": "/snapshots/TST-9999/after_theme.liquid"
    }
  ],
  "access_status": "active"
}
```

---

## 7. NEXUS INTEGRATION

To ensure zero cross-contamination and maximum security, the integration between Nexus, Supabase, and Qwep strictly adheres to the following rules:

- **Nexus is a pure frontend + dashboard layer.** It provides the UI for the owner to view tickets and the UI for clients to interact. It has NO internal database state of its own.
- **Supabase is the single source of truth** for tickets, jobs, changes, and evidence. 
- **Qwep only interacts with Supabase.** Qwep never directly connects to the Nexus container or Stripe. Qwep acts purely as a worker that pulls work from Supabase and pushes results back to Supabase.
- **Qwep writes all status updates, logs, and evidence back into Supabase** where it is permanently stored.
- **Nexus only reads from Supabase.** Nexus never stores, intercepts, or processes credentials. 
- **All access credentials are stored encrypted in Qwep’s local store (QwepStore).** They are never placed into Supabase and never exposed to Nexus.

### Nexus Query Logic
- **Job Status:** Nexus queries `Supabase.service_tickets` directly for real-time status updates (`in_progress`, `awaiting_review`, etc.).
- **Evidence Packs:** Nexus queries `Supabase` for the `Change Summary` markdown and snapshot references uploaded by Qwep at the end of the job.
- **Credential Handling:** If a client submits credentials via the Nexus intake portal, the payload is immediately encrypted via public key on the frontend, sent to Supabase `secure_intakes`, and then pulled down and decrypted locally by Qwep. Nexus never holds the unencrypted string.
