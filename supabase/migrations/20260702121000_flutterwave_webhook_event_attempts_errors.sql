-- Webhook ops diagnostics: processing attempts + structured last_error.

alter table if exists public.flutterwave_webhook_events
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists last_error jsonb not null default '{}'::jsonb;

create index if not exists flutterwave_webhook_events_attempts_idx
  on public.flutterwave_webhook_events (processing_attempts desc, received_at desc);
