-- Flutterwave webhook idempotency claim table.
-- Ensures a webhook event_id is processed once before any projection writes.

create table if not exists public.flutterwave_webhook_events (
  id             uuid primary key default gen_random_uuid(),
  event_id       text not null unique,
  event_type     text not null,
  flow           text not null check (flow in ('collection','transfer','unknown')),
  processing_status text not null default 'processing'
                   check (processing_status in ('processing','completed','failed','duplicate_ignored')),
  payload        jsonb not null default '{}'::jsonb,
  metadata       jsonb not null default '{}'::jsonb,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz
);

create index if not exists flutterwave_webhook_events_flow_idx
  on public.flutterwave_webhook_events (flow, received_at desc);

create index if not exists flutterwave_webhook_events_status_idx
  on public.flutterwave_webhook_events (processing_status, received_at desc);

alter table public.flutterwave_webhook_events enable row level security;

drop policy if exists flutterwave_webhook_events_admin_read on public.flutterwave_webhook_events;
create policy flutterwave_webhook_events_admin_read
  on public.flutterwave_webhook_events
  for select
  to authenticated
  using (public.is_borderpay_admin());

drop policy if exists flutterwave_webhook_events_service_role on public.flutterwave_webhook_events;
create policy flutterwave_webhook_events_service_role
  on public.flutterwave_webhook_events
  for all
  to service_role
  using (true)
  with check (true);
