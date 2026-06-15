# BOOKKEEPING SYSTEM SPECIFICATION

## 1. Local Database (QwepStore)
Qwep operates a local SQLite ledger that acts as the absolute source of truth for work performed. It tracks every transition, file modification, and API call.

### Schema: `jobs`
- `job_id` (UUID)
- `ticket_id` (Reference to Supabase)
- `ticket_type` ('real' | 'test')
- `user_id`
- `status` (intake_pending -> assigned -> in_progress -> review -> complete)
- `created_at` / `updated_at` (Timestamp to the second)

### Schema: `job_status_history`
- `history_id` (UUID)
- `ticket_id`
- `old_status`
- `new_status`
- `timestamp` (Timestamp to the second)
Tracks the exact lifecycle duration of every job.

### Schema: `audit_logs`
- `log_id` (UUID)
- `ticket_id`
- `target_system` (e.g., 'github', 'shopify', 'filesystem')
- `action` (e.g., 'cloned_repo', 'pushed_commit', 'deleted_credentials')
- `timestamp`

### Schema: `error_reports`
- `error_id`
- `ticket_id`
- `error_code`
- `requires_rollback` (Boolean)

## 2. Sync Mechanism
Once Qwep finishes a job or hits a milestone, a JSON payload summarizing the local SQLite rows (duration, start_time, end_time, actions) is pushed to Supabase `service_tickets` under `fulfillment_metadata`. This ensures Nexus can render the bookkeeping data without accessing Qwep.
