set search_path = public, pg_temp;

-- 30-day grace enforcement bookkeeping.
alter table public.user_profiles
  add column if not exists maintenance_grace_expired boolean not null default false,
  add column if not exists maintenance_grace_checked_at timestamptz;

create table if not exists public.bridge_identity_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_type text not null check (account_type in ('individual','business')),
  profile_table text not null check (profile_table in ('user_profiles','business_profiles')),
  bridge_customer_id text not null,
  action text not null check (action in ('delete_bridge_customer','clear_local_bridge_id','skip')),
  status text not null check (status in ('success','failed')),
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bridge_identity_cleanup_audit_user_idx
  on public.bridge_identity_cleanup_audit (user_id, created_at desc);

alter table public.bridge_identity_cleanup_audit enable row level security;

drop policy if exists bica_admin_read on public.bridge_identity_cleanup_audit;
create policy bica_admin_read on public.bridge_identity_cleanup_audit
  for select to authenticated
  using (public.is_borderpay_admin());

drop policy if exists bica_service_role on public.bridge_identity_cleanup_audit;
create policy bica_service_role on public.bridge_identity_cleanup_audit
  for all to service_role
  using (true)
  with check (true);

create or replace function public.enforce_maintenance_grace(p_grace_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if p_grace_days < 1 then
    p_grace_days := 30;
  end if;

  update public.user_profiles up
     set maintenance_grace_expired = (
           (
             up.maintenance_overdue = true
             and up.maintenance_overdue_since is not null
             and up.maintenance_overdue_since <= (now() - make_interval(days => p_grace_days))
           )
           or
           (
             up.wallet_maintenance_overdue = true
             and up.wallet_maintenance_overdue_since is not null
             and up.wallet_maintenance_overdue_since <= (now() - make_interval(days => p_grace_days))
           )
         ),
         maintenance_grace_checked_at = now()
   where
     up.maintenance_overdue = true
     or up.wallet_maintenance_overdue = true
     or up.maintenance_grace_expired = true;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.enforce_maintenance_grace(integer) from public, anon, authenticated;
grant execute on function public.enforce_maintenance_grace(integer) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'maintenance-grace-enforcement-daily') then
    perform cron.unschedule('maintenance-grace-enforcement-daily');
  end if;

  perform cron.schedule(
    'maintenance-grace-enforcement-daily',
    '40 2 * * *',
    $cron$select public.enforce_maintenance_grace(30);$cron$
  );
exception when others then
  null;
end $$;
