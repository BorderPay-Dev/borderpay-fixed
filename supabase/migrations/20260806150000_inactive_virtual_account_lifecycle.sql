-- Deactivate Bridge virtual accounts 30 days after activation when the owner
-- has never received a real Bridge credit through a fiat VA or USDC/USDT wallet.

alter table public.bridge_virtual_accounts
  add column if not exists activated_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text;

-- Existing local rows were inserted when the provider VA was first mirrored;
-- use that conservative timestamp rather than risk parsing untrusted JSON.
update public.bridge_virtual_accounts
set activated_at = created_at
where activated_at is null;

alter table public.bridge_virtual_accounts
  alter column activated_at set default now(),
  alter column activated_at set not null;

alter table public.bridge_virtual_accounts
  drop constraint if exists bridge_virtual_accounts_status_check;
alter table public.bridge_virtual_accounts
  add constraint bridge_virtual_accounts_status_check
  check (status in ('active', 'suspended', 'deactivated', 'closed'));

create index if not exists bva_inactivity_scan_idx
  on public.bridge_virtual_accounts (status, activated_at)
  where status = 'active';

create table if not exists public.va_inactivity_deactivations (
  id uuid primary key default gen_random_uuid(),
  bridge_virtual_account_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null,
  activated_at timestamptz not null,
  qualifying_incoming_at timestamptz,
  eligibility_checked_at timestamptz not null default now(),
  provider_deactivated_at timestamptz,
  email_sent_at timestamptz,
  email_last_error text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bridge_virtual_account_id, activated_at)
);

alter table public.va_inactivity_deactivations enable row level security;
drop policy if exists va_inactivity_deactivations_admin_read on public.va_inactivity_deactivations;
create policy va_inactivity_deactivations_admin_read
  on public.va_inactivity_deactivations for select to authenticated
  using (public.is_borderpay_admin());
drop policy if exists va_inactivity_deactivations_service_role on public.va_inactivity_deactivations;
create policy va_inactivity_deactivations_service_role
  on public.va_inactivity_deactivations for all to service_role
  using (true) with check (true);

drop trigger if exists trg_va_inactivity_deactivations_updated on public.va_inactivity_deactivations;
create trigger trg_va_inactivity_deactivations_updated
before update on public.va_inactivity_deactivations
for each row execute function public.set_updated_at();

create or replace function public.invoke_inactive_va_deactivation()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text;
  v_worker_token text;
  v_url text;
begin
  v_worker_url := nullif(current_setting('app.process_pending_events_url', true), '');
  v_worker_token := nullif(current_setting('app.process_pending_events_jwt', true), '');

  if (v_worker_url is null or v_worker_token is null) and to_regclass('public.app_config') is not null then
    select max(value) filter (where key = 'worker_url'),
           max(value) filter (where key = 'worker_auth_token')
      into v_worker_url, v_worker_token
      from public.app_config
     where key in ('worker_url', 'worker_auth_token');
  end if;

  if v_worker_url is null or v_worker_token is null then
    raise warning 'inactive VA deactivation skipped: worker runtime configuration missing';
    return;
  end if;

  v_url := regexp_replace(v_worker_url, '/process-pending-events/?$', '/deactivate-inactive-virtual-accounts');
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_worker_token
    ),
    body := '{"dry_run":false,"limit":100}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.invoke_inactive_va_deactivation() from public, anon, authenticated;
grant execute on function public.invoke_inactive_va_deactivation() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'deactivate-inactive-virtual-accounts') then
    perform cron.unschedule('deactivate-inactive-virtual-accounts');
  end if;
  perform cron.schedule(
    'deactivate-inactive-virtual-accounts',
    '15 3 * * *',
    'select public.invoke_inactive_va_deactivation();'
  );
end;
$$;
