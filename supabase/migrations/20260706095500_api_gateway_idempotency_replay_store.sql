-- Step 2B: gateway-level idempotency replay store for all mutating API routes.

create table if not exists public.api_idempotency_replays (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.api_tenants(id) on delete cascade,
  api_key_id          uuid not null references public.api_keys(id) on delete cascade,
  route_key           text not null,
  idempotency_key     text not null,
  request_hash        text not null,
  status_code         integer not null,
  response_body       jsonb not null,
  error_code          text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '24 hours'),
  constraint api_idempotency_key_len check (char_length(idempotency_key) between 8 and 256),
  constraint api_idempotency_hash_len check (char_length(request_hash) = 64)
);

create unique index if not exists api_idempotency_replays_unique
  on public.api_idempotency_replays (tenant_id, api_key_id, route_key, idempotency_key);

create index if not exists api_idempotency_replays_created_idx
  on public.api_idempotency_replays (created_at desc);

create index if not exists api_idempotency_replays_expires_idx
  on public.api_idempotency_replays (expires_at);

alter table public.api_idempotency_replays enable row level security;

drop policy if exists api_idempotency_replays_service_role on public.api_idempotency_replays;
create policy api_idempotency_replays_service_role on public.api_idempotency_replays
  for all to service_role using (true) with check (true);

drop policy if exists api_idempotency_replays_admin_select on public.api_idempotency_replays;
create policy api_idempotency_replays_admin_select on public.api_idempotency_replays
  for select to authenticated using (public.is_borderpay_admin());

create or replace function public.api_gateway_trim_idempotency_replays(
  p_keep_hours integer default 48
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_cutoff  timestamptz := now() - make_interval(hours => greatest(1, coalesce(p_keep_hours, 48)));
begin
  delete from public.api_idempotency_replays
   where expires_at < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
