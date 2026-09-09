-- Latest complete read-only provider inventories used by operator reporting.
-- Webhooks maintain live deltas; periodic provider GET reconciliation repairs
-- missed or pre-ingestion lifecycle events. Provider credentials and raw bank
-- instructions are never exposed to authenticated clients.

create table if not exists public.provider_inventory_snapshots (
  provider text not null,
  resource_type text not null,
  captured_at timestamptz not null,
  complete boolean not null default false,
  resource_count integer not null default 0 check (resource_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, resource_type)
);

alter table public.provider_inventory_snapshots enable row level security;

revoke all on table public.provider_inventory_snapshots from anon, authenticated;
grant all on table public.provider_inventory_snapshots to service_role;

comment on table public.provider_inventory_snapshots is
  'Latest complete provider GET inventory. Service-role only; used for operator reconciliation, never transaction execution.';
