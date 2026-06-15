# BACKEND / API AUDIT: MISSING COMPONENTS

## 1. Missing Stripe Webhook Handler (Severity: CRITICAL)
- **Missing:** Secure endpoint to process payment events.
- **Explanation:** The system spec requires `purchase_id` to be tied to jobs. There is no Cloudflare Worker or Edge Function currently deployed to catch Stripe `checkout.session.completed` webhooks and insert them into Supabase.
- **Required Fix:** Write and deploy `stripe-webhook-worker.js`.

## 2. Missing Policy Validation Middleware (Severity: CRITICAL)
- **Missing:** Edge validation to reject jobs without policy acceptance.
- **Explanation:** Supabase RLS isn't currently enforcing the existence of a `policy_acceptance_logs` row before allowing an insert into `service_tickets`.
- **Required Fix:** Write a Postgres Database Trigger to block `INSERT` on `service_tickets` if policy logs are absent.
