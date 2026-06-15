# POLICY ENFORCEMENT SPECIFICATION

## Legal Shield Architecture
The system enforces strict legal compliance via Florida State Law (FDUTPA) and standard liability mitigation. Work cannot commence unless the legal shield is fully activated.

### 1. Mandatory UI Acceptance
The `INTAKE_UI.html` blocks submission via strict JavaScript and HTML5 validation until 5 checkboxes are checked:
- Terms of Service
- Privacy Policy
- Refund Policy
- Liability Limitations
- AI-Assisted Work Disclosure

### 2. Immutable Policy Logging (Supabase)
Table: `policy_acceptance_logs`
- `log_id`
- `user_id`
- `ticket_id`
- `ip_address`
- `terms_accepted` (BOOLEAN NOT NULL)
- `privacy_accepted` (BOOLEAN NOT NULL)
- `refund_accepted` (BOOLEAN NOT NULL)
- `liability_accepted` (BOOLEAN NOT NULL)
- `ai_disclosure_accepted` (BOOLEAN NOT NULL)
- `policy_version`
- `timestamp` (Time Zone UTC)

### 3. Pipeline Enforcement
- **Backend Check**: Supabase triggers check if `policy_acceptance_logs` has a record for `ticket_id`.
- **Worker Check**: Qwep's `QWEP_REALTIME_LISTENER` drops any payload that does not contain a validated legal flag. Qwep will not touch a client's site without legal authorization.
