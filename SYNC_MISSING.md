# SYNC AUDIT: MISSING COMPONENTS

## 1. Missing Qwep-to-Supabase Writeback (Severity: CRITICAL)
- **Missing:** The REST client in Qwep to update `service_tickets`.
- **Explanation:** The Realtime listener successfully claims jobs, but there is no code written for Qwep to push `status = complete` back to Supabase once the job is actually done.
- **Required Fix:** Write the `job_completion_handler.js` that pushes updates back to Supabase.

## 2. Missing Dashboard Readbacks (Severity: HIGH)
- **Missing:** The Nexus frontend data fetching logic.
- **Explanation:** The dashboard HTML exists, but it has no JavaScript to actually query `supabase.from('service_tickets')` to populate the user's view.
- **Required Fix:** Wire up the Nexus React/Vanilla frontend to the Supabase client.
