-- ============================================================================
-- legal_security_tickets.sql — RUN IN SUPABASE SQL EDITOR (idempotent, safe to re-run)
-- Fixes: (1) owner-data leak, (2) ToS consent logging, (3) service ticket system.
-- Spec'd in ECAM CLAUDE_HANDOFF "Auth Redesign Required" (tos_consents, product_usage_logs, etc.).
-- AFTER running: set YOUR account as owner →  update public.profiles set role='owner' where id = '<your-auth-uid>';
-- ============================================================================

-- ── 0. Roles: nobody is owner/admin by default ──────────────────────────────
alter table public.profiles add column if not exists role text not null default 'user';
-- (valid: 'user' | 'owner'. Default 'user' so NO new account ever gets your tier/resources.)

-- HARDENING: a user must NOT escalate their own role (e.g. via the profile-edit form).
-- Block updating the role column for normal users; allow only the SQL editor (postgres) / service_role.
revoke update (role) on public.profiles from authenticated, anon;
create or replace function public.prevent_role_self_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('postgres','service_role')
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'role may only be changed by an admin';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_no_role_self_change on public.profiles;
create trigger profiles_no_role_self_change before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

-- ── 1. SECURITY: lock owner-only data to role='owner' (the leak fix) ─────────
-- contact_messages: only the owner may read. (Anyone may INSERT via the contact form — see existing.)
alter table if exists public.contact_messages enable row level security;
drop policy if exists "owner_select_contact_messages" on public.contact_messages;
create policy "owner_select_contact_messages" on public.contact_messages
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

-- Owner-stats RPCs: SECURITY DEFINER + owner-gated (a non-owner calling them gets 0/denied).
-- Drop first — an older version may have a different return type (Postgres can't replace that).
drop function if exists public.count_total_users();
drop function if exists public.count_active_users(integer);
create or replace function public.count_total_users()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner') then
    return null;  -- not owner → no data
  end if;
  return (select count(*)::int from auth.users);
end; $$;

create or replace function public.count_active_users(minutes_ago integer default 10)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner') then
    return null;
  end if;
  return (select count(*)::int from auth.users where last_sign_in_at > now() - (minutes_ago || ' minutes')::interval);
end; $$;
revoke all on function public.count_total_users() from public, anon;
revoke all on function public.count_active_users(integer) from public, anon;
grant execute on function public.count_total_users() to authenticated;
grant execute on function public.count_active_users(integer) to authenticated;

-- ── 2. ToS CONSENT LOG — prove who agreed to what, and when (liability cover) ─
create table if not exists public.tos_consents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  doc         text not null,          -- 'account_terms' | 'product:<slug>' | 'service:<slug>'
  version     text not null default 'v1',
  detail      jsonb,                  -- what the product/service entailed at agree-time
  agreed_at   timestamptz not null default now(),
  ip          text,
  user_agent  text
);
create index if not exists tos_consents_user_idx on public.tos_consents(user_id);
alter table public.tos_consents enable row level security;
drop policy if exists "insert own consent" on public.tos_consents;
create policy "insert own consent" on public.tos_consents for insert with check (user_id = auth.uid());
drop policy if exists "read own consent" on public.tos_consents;
create policy "read own consent" on public.tos_consents for select using (
  user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

-- ── 3. SERVICE TICKETS — ticket number + identifier tying a buyer to a service ─
create sequence if not exists public.service_ticket_seq start 1001;
create table if not exists public.service_tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text unique not null default ('UND-' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.service_ticket_seq')::text, 5, '0')),
  user_id       uuid not null references auth.users(id) on delete cascade,
  service_slug  text not null,        -- 'website-fix-quick' | 'website-fix-bundle' | 'website-fix-cleanup' | ...
  service_name  text,
  status        text not null default 'new',   -- new | scoped | paid | in_progress | delivered | closed
  amount_cents  integer,
  consent_id    uuid references public.tos_consents(id),   -- the agreement that authorized this work
  detail        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists service_tickets_user_idx on public.service_tickets(user_id);
alter table public.service_tickets enable row level security;
drop policy if exists "read own tickets" on public.service_tickets;
create policy "read own tickets" on public.service_tickets for select using (
  user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
drop policy if exists "insert own ticket" on public.service_tickets;
create policy "insert own ticket" on public.service_tickets for insert with check (user_id = auth.uid());
-- Owner updates ticket status; writes from the webhook use the service-role key (bypasses RLS).
drop policy if exists "owner update tickets" on public.service_tickets;
create policy "owner update tickets" on public.service_tickets for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

-- DONE. Then:  update public.profiles set role='owner' where id = auth.uid();  (run while logged in as you)
