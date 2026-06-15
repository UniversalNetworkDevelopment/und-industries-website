# NEXUS API SPECIFICATION
**Version:** 1.0.0
**Purpose:** Defines the REST surface for Nexus to read fulfillment data without touching Qwep directly.

## 1. ARCHITECTURE ENFORCEMENT
- **Nexus** acts exclusively as the frontend/dashboard layer.
- **Supabase** acts as the singular data backbone.
- **Nexus NEVER connects to Qwep.**
- **Nexus NEVER holds unencrypted credentials.**

## 2. CLIENT DASHBOARD ENDPOINTS (Nexus → Supabase)

**GET `/rest/v1/service_tickets?user_id=eq.{user_id}`**
- **Purpose:** Fetches the status of all active tickets for the logged-in client.
- **Response:**
```json
[
  {
    "ticket_id": "TST-9999",
    "service_slug": "quick_fix",
    "status": "in_progress",
    "created_at": "..."
  }
]
```

**POST `/rest/v1/secure_intakes`**
- **Purpose:** The endpoint the Intake UI uses to submit AES-encrypted credentials.
- **Payload:** `ticket_id`, `user_id`, `encrypted_payload`.
- **Security:** RLS locked to `auth.uid()`.

## 3. OWNER DASHBOARD ENDPOINTS (Nexus → QwepStore via local network)

**GET `http://127.0.0.1:3133/api/fulfillment/jobs`**
- **Purpose:** Owner views all jobs in Qwep's local memory.
- **Filters:** `?status=awaiting_review`

**GET `http://127.0.0.1:3133/api/fulfillment/jobs/:ticket_id/evidence`**
- **Purpose:** Owner pulls the Evidence Pack and before/after snapshot references to verify Qwep didn't break anything.
- **Response:**
```json
{
  "ticket_id": "TST-9999",
  "evidence_pack": "/snapshots/TST-9999/pack.zip",
  "markdown_summary": "1. Modified header.liquid\n2. Fixed CSS padding.",
  "changes": [
    {
      "action": "theme_update",
      "before_ref": "ID-1111",
      "after_ref": "ID-2222"
    }
  ]
}
```

**POST `http://127.0.0.1:3133/api/fulfillment/jobs/:ticket_id/approve`**
- **Purpose:** Owner manually forces an approval, telling Qwep to purge the `/tmp` credentials and mark the job `completed`.
