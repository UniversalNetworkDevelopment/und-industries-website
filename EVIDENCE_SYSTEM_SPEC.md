# EVIDENCE SYSTEM SPECIFICATION

## Evidence Pack Architecture
To eliminate liability and easily dispute chargebacks, Qwep produces an immutable Evidence Pack for every completed or failed job.

### 1. The Evidence Pack Structure
Generated locally by Qwep and then uploaded to a secure Supabase storage bucket (`evidence_archives`).
- `manifest.json`: Start/end timestamps, duration, ticket ID, purchase ID.
- `/Snapshots/`: Before and after PNG/JPEG screenshots of the website/store.
- `changelog.md`: Human-readable summary of files touched and API calls made.
- `git_log.txt`: Export of `git log` showing exact commit hashes and diffs.

### 2. Database Tracking
Table: `changes`
- `before_snapshot_ref`
- `after_snapshot_ref`
- `target_system`

Table: `evidence_packs`
- `archive_path`
- `markdown_summary`
- `created_at`

### 3. Legally Defensible Storage
Once an evidence pack is generated, it is zipped and hashed (SHA-256). The hash is logged in `audit_logs`. This proves mathematically that the evidence has not been tampered with since Qwep created it.
