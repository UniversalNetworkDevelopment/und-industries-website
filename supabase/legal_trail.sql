-- ============================================================================
-- legal_trail.sql — RUN IN SUPABASE SQL EDITOR (idempotent, safe to re-run)
-- Purpose: a tamper-resistant, connected legal/audit trail so a buyer can't
-- claim "I never agreed / didn't know." Ties together: account, the ToS
-- agreement (server-recorded), purchases, service tickets, and policy versions.
-- Requires legal_security_tickets.sql to have run first (tos_consents, etc.).
-- ============================================================================

-- ── 1. Record the ACCOUNT-LEVEL ToS agreement server-side (immutable) ────────
-- The browser sets agreed_terms in auth metadata at signup; that alone is weak
-- (user-asserted, mutable). This trigger copies it into tos_consents at the
-- moment the account is created — server-side, timestamped by the DB, and
-- immutable to the user (tos_consents has no user UPDATE/DELETE policy).
-- It is EXCEPTION-SAFE: if logging ever fails it must NEVER block signup.
create or replace function public.record_account_terms()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.tos_consents (user_id, doc, version, detail, agreed_at)
    values (
      new.id,
      'account_terms',
      coalesce(new.raw_user_meta_data->>'agreed_terms_version', 'unspecified'),
      jsonb_build_object(
        'source', 'signup',
        'agreed_terms', coalesce((new.raw_user_meta_data->>'agreed_terms')::boolean, null),
        'email_at_signup', new.email
      ),
      coalesce((new.raw_user_meta_data->>'agreed_terms_at')::timestamptz, now())
    );
  exception when others then
    null; -- never block account creation on a logging failure
  end;
  return new;
end; $$;

drop trigger if exists on_auth_user_created_record_terms on auth.users;
create trigger on_auth_user_created_record_terms
  after insert on auth.users
  for each row execute function public.record_account_terms();

-- Backfill: give every EXISTING account an account_terms consent row (once).
insert into public.tos_consents (user_id, doc, version, detail, agreed_at)
select u.id, 'account_terms',
       coalesce(u.raw_user_meta_data->>'agreed_terms_version', 'unspecified'),
       jsonb_build_object('source','backfill',
                          'agreed_terms', coalesce((u.raw_user_meta_data->>'agreed_terms')::boolean, null),
                          'email_at_signup', u.email),
       coalesce((u.raw_user_meta_data->>'agreed_terms_at')::timestamptz, u.created_at)
from auth.users u
where not exists (
  select 1 from public.tos_consents c where c.user_id = u.id and c.doc = 'account_terms'
);

-- ── 2. OWNER EVIDENCE TOOL — pull one user's COMPLETE trail in one call ───────
-- Returns: the account, profile, every agreement (account + per product/service
-- with version/IP/policy-text), every service ticket, purchase, and entitlement.
-- Owner-only (SECURITY DEFINER + role check). This is your "show the proof" call.
create or replace function public.user_audit_trail(target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  -- Owner via the app (auth.uid()) OR the admin SQL editor / server (postgres,
  -- service_role). The SQL editor has no auth.uid(), so it needs the latter.
  if not (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
    or session_user in ('postgres','service_role')   -- session_user = real login; current_user would be the DEFINER owner (always postgres) => bypass-for-all bug
  ) then
    raise exception 'Not authorized: owner only.';
  end if;
  select jsonb_build_object(
    'generated_at', now(),
    'user',     (select to_jsonb(u) from (select id, email, created_at, last_sign_in_at from auth.users where id = target) u),
    'profile',  (select to_jsonb(p) from public.profiles p where p.id = target),
    'consents', coalesce((select jsonb_agg(to_jsonb(c) order by c.agreed_at) from public.tos_consents  c where c.user_id = target), '[]'::jsonb),
    'service_tickets', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.service_tickets t where t.user_id = target), '[]'::jsonb),
    'purchases',    coalesce((select jsonb_agg(to_jsonb(pu) order by pu.created_at) from public.purchases   pu where pu.user_id = target), '[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(to_jsonb(e))  from public.entitlements e  where e.user_id = target), '[]'::jsonb)
  ) into result;
  return result;
end; $$;
revoke all on function public.user_audit_trail(uuid) from public, anon;
grant execute on function public.user_audit_trail(uuid) to authenticated;

-- Same, but look the user up by email (you usually won't have their uid handy).
create or replace function public.user_audit_trail_by_email(target_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
    or session_user in ('postgres','service_role')   -- session_user = real login; current_user would be the DEFINER owner (always postgres) => bypass-for-all bug
  ) then
    raise exception 'Not authorized: owner only.';
  end if;
  select id into uid from auth.users where lower(email) = lower(target_email) limit 1;
  if uid is null then return jsonb_build_object('error', 'No user with that email.'); end if;
  return public.user_audit_trail(uid);
end; $$;
revoke all on function public.user_audit_trail_by_email(text) from public, anon;
grant execute on function public.user_audit_trail_by_email(text) to authenticated;

-- DONE. Usage (as owner, in SQL editor or from the dashboard):
--   select public.user_audit_trail_by_email('customer@example.com');
-- => one JSON blob = their account + every agreement (version/IP/policy text) +
--    purchases + tickets. That is the evidence trail.
