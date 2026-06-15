-- Create system_logs table for Nexus telemetry

create table if not exists public.system_logs (
    id uuid default gen_random_uuid() primary key,
    created_at timestamp with time zone default now() not null,
    user_id uuid references auth.users(id) on delete set null,
    action text not null,
    severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
    ip text,
    device_fingerprint text,
    detail jsonb
);

-- Turn on RLS
alter table public.system_logs enable row level security;

-- Admin and Nexus Apps can read logs
create policy "Admins can read system_logs" 
on public.system_logs for select 
using (auth.role() = 'service_role' or auth.uid() in (
    select id from public.profiles where role = 'owner' or role = 'admin'
));

-- Anyone (including anon Cloudflare edge functions) can insert logs (append-only)
create policy "Anyone can insert system logs"
on public.system_logs for insert
with check (true);
