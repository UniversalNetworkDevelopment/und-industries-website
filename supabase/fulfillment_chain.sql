-- ============================================================================
-- fulfillment_chain.sql — completes the post-payment fulfillment chain.
-- RUN IN SUPABASE SQL EDITOR. Idempotent + ADDITIVE (safe to re-run).
-- Extends the EXISTING public.service_tickets (no competing table).
-- Closes the fraud-shaped gap: pay -> RETURN to secure collection -> intake -> fulfil -> proof.
-- Agents that fulfil = 'qwep' (+ 'axiom' for security). NEVER 'the private sovereign AI' (private, Rule 17).
-- RLS uses auth.uid()/role='owner' (NEVER current_user). Raw passwords are NEVER stored.
-- ============================================================================

-- 1) service_tickets: post-payment secure intake + fulfilment tracking ---------
alter table public.service_tickets add column if not exists intake_status   text not null default 'awaiting_intake';
  -- awaiting_intake | submitted | in_progress | delivered
alter table public.service_tickets add column if not exists access_method    text;
  -- github_collaborator | shopify_staff | cms_temp_admin | scoped_api_key | temp_user | file_upload | screen_share
alter table public.service_tickets add column if not exists access_confirmed  boolean not null default false;
alter table public.service_tickets add column if not exists order_details     jsonb;   -- NON-sensitive: target URL, fault log, requirements
alter table public.service_tickets add column if not exists assigned_agent    text;    -- 'qwep' | 'axiom'  (NEVER 'the private sovereign AI')
alter table public.service_tickets add column if not exists completed_at      timestamptz;
alter table public.service_tickets add column if not exists deployed_url      text;

-- Let the buyer UPDATE their own ticket ONLY while awaiting intake (submit once).
drop policy if exists "client submit intake" on public.service_tickets;
create policy "client submit intake" on public.service_tickets for update
  using (user_id = auth.uid() and intake_status = 'awaiting_intake')
  with check (user_id = auth.uid());

-- 2) product_usage_proof — DO NOT DEFINE HERE (duplicate caught + removed 2026-06-20).
--    It already exists, richer, in UND-Nexus\compliance_schema.sql (with log_of_thought,
--    is_website_owner(), user_usage_proof()). RUN compliance_schema.sql FIRST.
--    Defining it here would silently conflict (create-if-not-exists no-ops, columns mismatch).

-- 3) feedback — WEBSITE-WIDE feedback button (any page, logged-in or not) ------
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,  -- nullable: anon allowed
  page       text,
  message    text not null,
  email      text,          -- optional reply-to for logged-out senders
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "anyone insert feedback" on public.feedback;
create policy "anyone insert feedback" on public.feedback for insert with check (true);
drop policy if exists "owner reads feedback" on public.feedback;
create policy "owner reads feedback" on public.feedback for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

-- 4) client_secure_tokens — LAST-RESORT ephemeral secret (72h auto-expire) -----
--    PREFER scoped invites (collaborator/staff) = nothing stored. Only use this
--    when a scoped API key is unavoidable. NEVER a raw account password.
create table if not exists public.client_secure_tokens (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid references public.service_tickets(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  label            text,                       -- e.g. 'shopify scoped API key (read products)'
  secret_encrypted text not null,              -- encrypted; NEVER a raw password
  expires_at       timestamptz not null default (now() + interval '72 hours'),
  consumed         boolean not null default false,
  created_at       timestamptz not null default now()
);
alter table public.client_secure_tokens enable row level security;
drop policy if exists "client insert own token" on public.client_secure_tokens;
create policy "client insert own token" on public.client_secure_tokens for insert with check (user_id = auth.uid());
-- No client SELECT (write-only from client). Service-role reads it once, then it's shredded.
-- 72h shredder (run via pg_cron, or Nexus on a timer):
--   update public.client_secure_tokens set secret_encrypted='[shredded]', consumed=true where expires_at < now() and not consumed;

-- DONE. After running: the website collection page writes intake -> Nexus reads service_tickets -> Qwep fulfils -> product_usage_proof.
