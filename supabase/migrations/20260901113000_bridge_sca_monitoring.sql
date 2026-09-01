-- Operator-visible Bridge EEA SCA monitoring signals.

create table if not exists public.sca_monitoring_alerts (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null unique,
  signal_type text not null check (signal_type in (
    'failed_authentication_pattern', 'authentication_lockout',
    'authorization_replay_or_mismatch', 'provider_scope_unavailable',
    'recovery_restriction'
  )),
  severity text not null check (severity in ('medium', 'high', 'critical')),
  user_id uuid references auth.users(id) on delete set null,
  event_count integer not null check (event_count > 0),
  window_started_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'closed')),
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sca_monitoring_alerts_status_created_idx
  on public.sca_monitoring_alerts (status, created_at desc);

alter table public.sca_monitoring_alerts enable row level security;
revoke all on public.sca_monitoring_alerts from anon, authenticated;
grant all on public.sca_monitoring_alerts to service_role;

comment on table public.sca_monitoring_alerts is
  'Deduplicated operator alerts derived from credential-free Bridge SCA audit events.';
