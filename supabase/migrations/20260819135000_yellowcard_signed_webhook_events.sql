-- Immutable evidence for authenticated Yellow Card transaction callbacks.
-- Runtime verifies X-YC-Signature over the exact raw body before inserting.

create table if not exists public.yellowcard_webhook_events (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('sandbox','production')),
  event_fingerprint text not null unique,
  sequence_id text not null,
  provider_transaction_id text,
  event_name text not null,
  status text not null,
  api_key_prefix text not null,
  signature_verified boolean not null check (signature_verified = true),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  executed_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists yellowcard_webhook_events_sequence_idx
  on public.yellowcard_webhook_events(environment,sequence_id,executed_at desc);

alter table public.yellowcard_webhook_events enable row level security;

drop policy if exists yellowcard_webhook_events_admin_read on public.yellowcard_webhook_events;
create policy yellowcard_webhook_events_admin_read on public.yellowcard_webhook_events
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists yellowcard_webhook_events_service_insert on public.yellowcard_webhook_events;
create policy yellowcard_webhook_events_service_insert on public.yellowcard_webhook_events
  for insert to service_role with check (signature_verified = true);

create or replace function public.yellowcard_webhook_events_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'yellowcard_webhook_events is immutable';
end;
$$;

drop trigger if exists trg_yellowcard_webhook_events_immutable on public.yellowcard_webhook_events;
create trigger trg_yellowcard_webhook_events_immutable
  before update or delete on public.yellowcard_webhook_events
  for each row execute function public.yellowcard_webhook_events_immutable();

revoke all on table public.yellowcard_webhook_events from public,anon,authenticated;
grant select on table public.yellowcard_webhook_events to authenticated;
grant select,insert on table public.yellowcard_webhook_events to service_role;

comment on table public.yellowcard_webhook_events is
  'Immutable raw Yellow Card callbacks accepted only after X-YC-Signature HMAC verification.';
