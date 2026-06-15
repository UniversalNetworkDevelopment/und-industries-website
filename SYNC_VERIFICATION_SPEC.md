# FRONTEND → BACKEND → NEXUS → QWEP SYNC VERIFICATION

## 1. The Sync Pipeline
1. **Frontend (Intake UI)** generates JSON payload + triggers Policy Logging.
2. **Backend (Supabase)** stores payload in `secure_intakes` and updates `service_tickets.status`.
3. **Bridge (Realtime)** Supabase broadcasts `UPDATE` event.
4. **Listener (Qwep)** catches `UPDATE`, validates schema, claims ticket, updates `status = in_progress`.
5. **Execution (Qwep)** local SQLite logs every step. Evidence pack generated.
6. **Return (Qwep -> Supabase)** Qwep updates `service_tickets` with `status = complete` and `evidence_url`.
7. **Nexus (Dashboard)** reads `service_tickets` and displays the evidence link to the owner.

## 2. Sync Verification Checklist
- [x] Intake UI payload schema strictly matches Supabase JSONB constraints.
- [x] Supabase `policy_acceptance_logs` enforces foreign key to `auth.users`.
- [x] Qwep Listener ignores malformed payloads (JSON schema validation).
- [x] Qwep updates Supabase status immediately upon claiming to prevent double execution.
- [x] Dashboard queries are read-only (zero direct writes to Qwep).

## 3. Sync Failure Detection (Pseudo-code)
```javascript
// Qwep Health/Sync Monitor
setInterval(async () => {
  const staleJobs = await supabase.from('service_tickets')
    .select('id')
    .eq('status', 'in_progress')
    .lte('updated_at', Date.now() - 3600000); // 1 hour timeout
  
  if (staleJobs.length > 0) {
    alertOwner(`Detected ${staleJobs.length} stale jobs. Qwep may have silently crashed.`);
    await triggerRollbackOrReassign(staleJobs);
  }
}, 300000);
```
