-- ============================================================================
-- U.N.D Industries — Payments / Financial System schema (Stripe)
-- Run in: Supabase Dashboard -> SQL Editor  (or `supabase db push`).
-- Idempotent: safe to run more than once.
--
-- Writes to these tables happen ONLY from the Cloudflare Pages Functions using
-- the service-role key (which bypasses RLS). The browser gets read-only access
-- to its OWN rows via the policies below. No client can write billing data.
-- ============================================================================

-- gen_random_uuid() ships with Supabase via pgcrypto; ensure it's present.
create extension if not exists pgcrypto;

-- Stripe customer per user --------------------------------------------------
create table if not exists public.customers (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique not null,
  email              text,
  created_at         timestamptz not null default now()
);

-- One-time purchases (store digital goods) ----------------------------------
create table if not exists public.purchases (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  product_id            uuid,
  product_slug          text,
  title                 text,
  amount_cents          integer,
  currency              text,
  stripe_session_id     text unique,
  stripe_payment_intent text,
  status                text not null default 'paid',
  created_at            timestamptz not null default now()
);
create index if not exists purchases_user_idx on public.purchases(user_id);

-- What a user is entitled to (access grants + license keys) -----------------
create table if not exists public.entitlements (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  product_id        uuid,
  product_slug      text,
  kind              text not null default 'purchase',   -- purchase | subscription
  license_key       text,
  status            text not null default 'active',     -- active | revoked
  source            text,
  stripe_session_id text,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (user_id, product_id)
);
create index if not exists entitlements_user_idx on public.entitlements(user_id);

-- Subscriptions (used when you turn on plans) -------------------------------
create table if not exists public.subscriptions (
  stripe_subscription_id text primary key,
  user_id                uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id     text,
  stripe_price_id        text,
  plan_id                text,
  status                 text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);

-- Sellable subscription plans (public catalog; you populate when ready) ------
create table if not exists public.plans (
  id              text primary key,        -- internal id, e.g. 'pro_monthly'
  name            text not null,
  stripe_price_id text not null,
  interval        text,                    -- month | year
  amount_cents    integer,
  currency        text default 'usd',
  role            text default 'pro',
  active          boolean not null default true,
  sort_order      integer default 0
);

-- Processed Stripe events (idempotency / audit) -----------------------------
create table if not exists public.webhook_events (
  id         text primary key,             -- Stripe event id (evt_...)
  type       text,
  created_at timestamptz not null default now()
);

-- Surface plan state to the existing profiles-based authorization -----------
alter table public.profiles add column if not exists plan          text;
alter table public.profiles add column if not exists plan_status   text;
alter table public.profiles add column if not exists plan_renews_at timestamptz;

-- ----------------------------------------------------------------------------
-- Row-Level Security: users read ONLY their own billing rows; nobody writes
-- from the client. The webhook/checkout Functions use the service-role key,
-- which bypasses RLS — so no INSERT/UPDATE policies are needed (or wanted).
-- ----------------------------------------------------------------------------
alter table public.customers      enable row level security;
alter table public.purchases      enable row level security;
alter table public.entitlements   enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.plans          enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists "read own customer" on public.customers;
create policy "read own customer" on public.customers
  for select using (auth.uid() = user_id);

drop policy if exists "read own purchases" on public.purchases;
create policy "read own purchases" on public.purchases
  for select using (auth.uid() = user_id);

drop policy if exists "read own entitlements" on public.entitlements;
create policy "read own entitlements" on public.entitlements
  for select using (auth.uid() = user_id);

drop policy if exists "read own subscriptions" on public.subscriptions;
create policy "read own subscriptions" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Plans are public catalog data (only active ones visible).
drop policy if exists "read active plans" on public.plans;
create policy "read active plans" on public.plans
  for select using (active = true);

-- webhook_events: no policies => only the service role can touch it.
