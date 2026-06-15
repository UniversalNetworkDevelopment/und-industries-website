# FULFILLMENT SYSTEM SPECIFICATION
**Version:** 1.0.0
**Target Engine:** Qwep (Sovereign Local AI)

## 1. EVENT BRIDGE (Supabase → Qwep)

**Source:** Supabase `service_tickets` table via REST API.
**Trigger:** Transition of `status` from `pending` (or `checkout_started`) to `paid`.

**Mechanism:**
- Qwep runs the `ticket-relay.js` sidecar daemon which polls the Supabase `/rest/v1/service_tickets?status=eq.paid` endpoint every 30 seconds.
- The daemon pushes the ticket data to Qwep's local REST API (`http://127.0.0.1:3133/api/chat`).
- Qwep operates with Zero Shared State. It never accesses Stripe or Cloudflare.

**QwepStore Internal Schema (`jobs` table in local SQLite/Postgres):**
```sql
CREATE TABLE jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(255) UNIQUE NOT NULL,
    user_id UUID NOT NULL,
    service_slug VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'intake_pending', -- intake_pending, intake_complete, in_progress, awaiting_review, completed, failed, refunded
    amount_cents INTEGER NOT NULL,
    payment_id VARCHAR(255),
    intake_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Idempotency & Claiming:**
1. Relay fetches `paid` tickets from Supabase.
2. Relay attempts an `INSERT` into QwepStore `jobs`.
3. If `ticket_number` already exists, the insert is ignored (idempotent).
4. If the insert succeeds, Qwep sends a `PATCH` to Supabase updating `status = 'intake_pending'` to claim the ticket and prevent double-processing.

---

## 2. CLIENT INTAKE SCHEMAS

When a job hits `intake_pending`, Qwep generates a secure email (or portal link) requesting the following JSON structures based on `service_slug`.

### Web Systems (Quick Fix, Bundle, Cleanup)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "site_url": { "type": "string", "format": "uri" },
    "issue_description": { "type": "string" },
    "access_method": { "enum": ["github_collaborator", "hosting_panel", "wordpress_admin"] },
    "credentials_portal_link": { "type": "string", "description": "Used to submit encrypted keys if required" }
  },
  "required": ["site_url", "issue_description", "access_method"]
}
```

### Shopify & Commerce
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "store_url": { "type": "string", "format": "uri" },
    "collaborator_code": { "type": "string" },
    "primary_goals": { "type": "string" },
    "supplier_preference": { "type": "string" }
  },
  "required": ["store_url", "primary_goals"]
}
```

### Automation & AI
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "platforms": { "type": "array", "items": { "type": "string" } },
    "workflow_description": { "type": "string" },
    "api_keys_submitted": { "type": "boolean" }
  },
  "required": ["platforms", "workflow_description"]
}
```

**Storage:** Intake payload is stored in QwepStore `jobs.intake_data`. Once validated, Qwep updates Supabase to `in_progress`.

---

## 3. ACCESS & SECURITY RULES

1. **Credentials:** 
   - Never stored in plaintext. Encrypted locally using a master key (`AES-256-GCM`).
   - Passed to headless browser contexts via environment variables or secure credential managers.
   - Never injected into LLM context windows (Gemini/Qwen).
2. **Scope Control:**
   - Qwep is strictly sandboxed. For website fixes, it clones the specific repo into an isolated `/tmp/jobs/{ticket_number}` directory.
   - It cannot execute `rm -rf /` or modify global billing settings.
3. **Revocation:**
   - Upon moving job to `completed`, Qwep deletes the isolated directory and wipes the encrypted credentials from QwepStore.

---

## 4. LOGGING, AUDIT TRAIL, AND EVIDENCE

To legally protect U.N.D Industries against "you broke it" claims, Qwep maintains a strict immutable audit trail.

**QwepStore `changes` Table:**
```sql
CREATE TABLE changes (
    change_id UUID PRIMARY KEY,
    ticket_number VARCHAR(255) REFERENCES jobs(ticket_number),
    change_type VARCHAR(50), -- 'file_edit', 'theme_update', 'workflow_add'
    before_snapshot_path VARCHAR(500),
    after_snapshot_path VARCHAR(500),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
- **Snapshots:** Before altering any file or Shopify theme, Qwep saves a raw copy of the file/theme to `E:\Qwep\Snapshots\{ticket_number}\before\`.
- **Completion Report:** A PDF/Markdown report is generated showing exactly what files were touched, alongside Visual QA screenshots.

---

## 5. ERROR HANDLING & REFUNDS

- **Access Timeout:** If intake is not completed in 7 days, job status becomes `failed_access`. Customer receives a notification.
- **System Too Broken:** If the architecture is fundamentally corrupted beyond the scope of the package (e.g. asking for a Quick Fix on a completely hacked WordPress site), Qwep marks job as `needs_manual_review` and halts. Owner is notified to issue a custom quote or refund.
- **Unexpected Error:** If Qwep crashes or fails 3 verification checks, it triggers a `git reset --hard` (rollback), marks `failed`, and pages the Owner.

---

## 6. REST API SURFACE FOR DASHBOARDS

Qwep exposes a local API (`http://127.0.0.1:3133/api/fulfillment`) for the Owner Dashboard.

`GET /api/fulfillment/jobs`
Returns all jobs. Supports `?status=in_progress`.
```json
{
  "jobs": [
    {
      "ticket_number": "TST-1234",
      "status": "in_progress",
      "service_slug": "quick",
      "amount_cents": 9900,
      "timeline": { "started_at": "...", "due_at": "..." }
    }
  ]
}
```

`GET /api/fulfillment/jobs/:ticket_number/audit`
Returns the array of changes and paths to snapshot evidence.
