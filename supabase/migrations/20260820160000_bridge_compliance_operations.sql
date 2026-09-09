-- Bridge funds-request (recall) compliance operations.
--
-- Funds requests are polled from Bridge because Bridge does not currently
-- publish webhooks for this resource. Provider payloads remain immutable
-- evidence; operator decisions and return execution are recorded separately.

set search_path = public, pg_temp;

create table if not exists public.bridge_funds_requests (
  provider_request_id text primary key,
  deposit_id text not null,
  bridge_customer_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  account_type text check (account_type in ('individual', 'business')),
  amount numeric(38, 18) not null check (amount > 0),
  currency text not null,
  payment_rail text not null,
  fraud boolean not null,
  notice_date date not null,
  deposit_created_at timestamptz,
  imad text,
  trace_number text,
  bank_transaction_id text,
  linkage_status text not null default 'unlinked'
    check (linkage_status in ('linked', 'unlinked', 'ambiguous')),
  raw_payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  provider_created_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists bridge_funds_requests_customer_idx
  on public.bridge_funds_requests (bridge_customer_id, notice_date desc);
create index if not exists bridge_funds_requests_user_idx
  on public.bridge_funds_requests (user_id, notice_date desc);
create index if not exists bridge_funds_requests_deposit_idx
  on public.bridge_funds_requests (deposit_id);

create table if not exists public.bridge_compliance_cases (
  id uuid primary key default gen_random_uuid(),
  funds_request_id text not null unique
    references public.bridge_funds_requests(provider_request_id) on delete restrict,
  status text not null default 'open'
    check (status in (
      'open', 'investigating', 'awaiting_customer', 'awaiting_bridge',
      'return_proposed', 'return_approved', 'return_submitted',
      'return_completed', 'return_failed', 'closed_no_return'
    )),
  priority text not null default 'high'
    check (priority in ('low', 'medium', 'high', 'critical')),
  customer_frozen boolean not null default false,
  customer_contacted boolean not null default false,
  evidence_complete boolean not null default false,
  evidence_references jsonb not null default '[]'::jsonb,
  investigation_notes text,
  response_deadline timestamptz,
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null
);

create index if not exists bridge_compliance_cases_status_idx
  on public.bridge_compliance_cases (status, priority, opened_at desc);

create table if not exists public.bridge_return_approvals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.bridge_compliance_cases(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  actor_role text not null,
  decision text not null check (decision in ('approve', 'reject')),
  rationale text not null check (length(trim(rationale)) >= 10),
  created_at timestamptz not null default now(),
  unique (case_id, actor_id)
);

create table if not exists public.bridge_return_operations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.bridge_compliance_cases(id) on delete restrict,
  idempotency_key text not null unique,
  bridge_customer_id text not null,
  deposit_id text not null,
  amount numeric(38, 18) not null check (amount > 0),
  destination_currency text not null,
  source_currency text not null,
  source_bridge_wallet_id text not null,
  bridge_transfer_id text unique,
  status text not null default 'prepared'
    check (status in ('prepared', 'submitted', 'pending', 'completed', 'failed', 'returned', 'canceled')),
  request_payload jsonb not null,
  response_payload jsonb,
  error_message text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.operator_provider_event_notifications (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  recipient text not null,
  channel text not null default 'email' check (channel in ('email', 'admin_alert')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'deduped')),
  provider_resource_id text,
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (provider, provider_event_id, recipient, channel)
);

create index if not exists operator_provider_event_notifications_created_idx
  on public.operator_provider_event_notifications (created_at desc);

alter table public.bridge_funds_requests enable row level security;
alter table public.bridge_compliance_cases enable row level security;
alter table public.bridge_return_approvals enable row level security;
alter table public.bridge_return_operations enable row level security;
alter table public.operator_provider_event_notifications enable row level security;

revoke all on public.bridge_funds_requests from anon, authenticated;
revoke all on public.bridge_compliance_cases from anon, authenticated;
revoke all on public.bridge_return_approvals from anon, authenticated;
revoke all on public.bridge_return_operations from anon, authenticated;
revoke all on public.operator_provider_event_notifications from anon, authenticated;

grant select on public.bridge_funds_requests to authenticated;
grant select on public.bridge_compliance_cases to authenticated;
grant select on public.bridge_return_approvals to authenticated;
grant select on public.bridge_return_operations to authenticated;
grant select on public.operator_provider_event_notifications to authenticated;
grant all on public.bridge_funds_requests to service_role;
grant all on public.bridge_compliance_cases to service_role;
grant all on public.bridge_return_approvals to service_role;
grant all on public.bridge_return_operations to service_role;
grant all on public.operator_provider_event_notifications to service_role;

drop policy if exists bridge_funds_requests_admin_read on public.bridge_funds_requests;
create policy bridge_funds_requests_admin_read on public.bridge_funds_requests
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bridge_compliance_cases_admin_read on public.bridge_compliance_cases;
create policy bridge_compliance_cases_admin_read on public.bridge_compliance_cases
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bridge_return_approvals_admin_read on public.bridge_return_approvals;
create policy bridge_return_approvals_admin_read on public.bridge_return_approvals
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists bridge_return_operations_admin_read on public.bridge_return_operations;
create policy bridge_return_operations_admin_read on public.bridge_return_operations
  for select to authenticated using (public.is_borderpay_admin());
drop policy if exists operator_provider_event_notifications_admin_read on public.operator_provider_event_notifications;
create policy operator_provider_event_notifications_admin_read on public.operator_provider_event_notifications
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists bridge_funds_requests_service_all on public.bridge_funds_requests;
create policy bridge_funds_requests_service_all on public.bridge_funds_requests
  for all to service_role using (true) with check (true);
drop policy if exists bridge_compliance_cases_service_all on public.bridge_compliance_cases;
create policy bridge_compliance_cases_service_all on public.bridge_compliance_cases
  for all to service_role using (true) with check (true);
drop policy if exists bridge_return_approvals_service_all on public.bridge_return_approvals;
create policy bridge_return_approvals_service_all on public.bridge_return_approvals
  for all to service_role using (true) with check (true);
drop policy if exists bridge_return_operations_service_all on public.bridge_return_operations;
create policy bridge_return_operations_service_all on public.bridge_return_operations
  for all to service_role using (true) with check (true);
drop policy if exists operator_provider_event_notifications_service_all on public.operator_provider_event_notifications;
create policy operator_provider_event_notifications_service_all on public.operator_provider_event_notifications
  for all to service_role using (true) with check (true);

comment on table public.bridge_funds_requests is
  'Authoritative Bridge funds-request snapshots polled from GET /v0/funds_requests; no funds-request webhook exists.';
comment on table public.bridge_return_operations is
  'Fail-closed, idempotent fiat-deposit return operations. A row is not evidence that Bridge completed the return.';

-- Bridge exposes no funds-request webhook. Poll every five minutes through the
-- same fail-closed internal worker configuration used by existing cron jobs.
create or replace function public.invoke_bridge_funds_request_poll()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_worker_url text := coalesce(
    nullif(current_setting('app.process_pending_events_url', true), ''),
    nullif(public.app_config_get('worker_url'), '')
  );
  v_worker_token text := coalesce(
    nullif(current_setting('app.process_pending_events_jwt', true), ''),
    nullif(public.app_config_get('worker_auth_token'), '')
  );
  v_url text;
begin
  if v_worker_url is null or v_worker_token is null then
    raise warning 'Bridge funds-request poll skipped: worker runtime configuration missing';
    return;
  end if;
  v_url := regexp_replace(v_worker_url, '/process-pending-events/?$', '/admin-compliance');
  if v_url = v_worker_url then
    raise warning 'Bridge funds-request poll skipped: worker URL is not canonical';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_worker_token
    ),
    body := '{"action":"sync_funds_requests"}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.invoke_bridge_funds_request_poll() from public, anon, authenticated;
grant execute on function public.invoke_bridge_funds_request_poll() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bridge-funds-request-poll') then
    perform cron.unschedule('bridge-funds-request-poll');
  end if;
  perform cron.schedule(
    'bridge-funds-request-poll',
    '*/5 * * * *',
    'select public.invoke_bridge_funds_request_poll();'
  );
end;
$$;
