-- ============================================================================
-- referral.sql — RUN IN SUPABASE SQL EDITOR (idempotent, safe to re-run)
-- One referral-code redemption per account. Stops a code being reused as an
-- unlimited-discount glitch — a second redeem of the SAME code by the SAME
-- account is blocked; they'd need a different code to save again.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.referral_redemptions (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  code          text        not null,
  ticket_number text,
  redeemed_at   timestamptz not null default now(),
  unique (user_id, code)          -- the hard backstop: one redeem per code, per account
);
create index if not exists referral_redemptions_user_idx on public.referral_redemptions(user_id);

alter table public.referral_redemptions enable row level security;

-- A user can see their own redemptions and insert their own. The UNIQUE
-- constraint makes a second insert of the same (user, code) fail — so even a
-- tampered client can't redeem the same code twice.
drop policy if exists "read own redemptions" on public.referral_redemptions;
create policy "read own redemptions" on public.referral_redemptions
  for select using (user_id = auth.uid());

drop policy if exists "insert own redemption" on public.referral_redemptions;
create policy "insert own redemption" on public.referral_redemptions
  for insert with check (user_id = auth.uid());

-- Owner can review all redemptions (who used what).
drop policy if exists "owner read redemptions" on public.referral_redemptions;
create policy "owner read redemptions" on public.referral_redemptions
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

-- NOTE (PayPal limitation): the discounted PayPal links are fixed URLs, so a
-- determined user could bookmark a discounted link and pay it directly, bypassing
-- this gate. This table enforces single-use within OUR booking flow + gives you
-- the record. For ironclad single-use, switch service checkout to Stripe
-- single-use promo codes (tracked as a future upgrade in SEO/payments notes).
