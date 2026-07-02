-- Replay cooldown tracking for webhook events.
-- Prevents rapid repeated manual replay attempts against the same event.

alter table if exists public.flutterwave_webhook_events
  add column if not exists last_replay_attempt_at timestamptz;

create index if not exists flutterwave_webhook_events_last_replay_attempt_idx
  on public.flutterwave_webhook_events (last_replay_attempt_at desc)
  where last_replay_attempt_at is not null;
