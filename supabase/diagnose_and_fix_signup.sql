-- ============================================================================
-- diagnose_and_fix_signup.sql — RUN IN SUPABASE SQL EDITOR
-- Symptom: creating ANY new user fails with "Database error creating new user"
--          (error_code: unexpected_failure). This blocks website signup AND
--          portal invites project-wide. Cause: a trigger on auth.users (the
--          profiles-creation trigger) raises and is NOT exception-safe, so the
--          whole auth.users INSERT rolls back.
--
-- This script: (A) shows you the triggers + the handle_new_user body + the
-- profiles columns that are NOT NULL without a default (the usual culprit),
-- then (B) installs an EXCEPTION-SAFE profiles-creation trigger so a profiles
-- side-effect can NEVER again block account creation (correct prod pattern).
-- Idempotent + safe to re-run. Run the whole thing; read the NOTICEs.
-- ============================================================================

-- ── (A) DIAGNOSTICS — read these result sets ────────────────────────────────

-- A1: every trigger on auth.users (the thing that can block signup)
select tgname               as trigger_name,
       proname              as function_name,
       pg_get_functiondef(p.oid) as function_body
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal;

-- A2: profiles columns that are NOT NULL and have NO default
--     (any of these that handle_new_user doesn't set = the failure)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- ── (B) FIX — make profiles creation exception-safe + self-sufficient ───────
-- Give every NOT NULL profiles column a safe default so a bare insert(id) works,
-- then install an exception-safe handle_new_user. Even if anything inside fails,
-- it returns NEW and signup proceeds (a missing profile is recoverable; a
-- blocked signup is not).

-- B1: backfill defaults on the common columns (no-op if already defaulted/typed differently)
do $$
begin
  begin alter table public.profiles alter column role set default 'user'; exception when others then null; end;
  begin alter table public.profiles alter column data_mode set default 'cloud'; exception when others then null; end;
  begin alter table public.profiles alter column created_at set default now(); exception when others then null; end;
end $$;

-- B2: exception-safe profiles creator
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.profiles (id, display_name)
    values (
      new.id,
      coalesce(
        new.raw_user_meta_data->>'display_name',
        new.raw_user_meta_data->>'full_name',
        split_part(new.email, '@', 1)
      )
    )
    on conflict (id) do nothing;
  exception when others then
    null; -- NEVER block account creation on a profile-row failure
  end;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- DONE. After running: try creating a user again (or re-run the portal QA).
-- If A1 showed OTHER triggers on auth.users (e.g. a custom one that is not
-- exception-safe), paste that result back and it will be fixed too.
