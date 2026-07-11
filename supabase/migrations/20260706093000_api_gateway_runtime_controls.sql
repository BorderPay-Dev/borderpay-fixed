-- Step 2 (P0 foundation): business API gateway runtime controls.
-- Adds tenant/api-key/auth controls used by the public API gateway layer.

create table if not exists public.api_tenants (
  id                     uuid primary key default gen_random_uuid(),
  -- Stored as an application pointer. Production user_profiles has a composite
  -- primary key (id, payment_provider), so a single-column FK is invalid.
  business_user_id       uuid,
  tenant_name            text not null,
  default_mode           text not null default 'sandbox' check (default_mode in ('sandbox', 'production')),
  is_active              boolean not null default true,
  rate_limit_per_minute  integer not null default 120 check (rate_limit_per_minute > 0 and rate_limit_per_minute <= 5000),
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists api_tenants_business_user_unique
  on public.api_tenants (business_user_id)
  where business_user_id is not null;

create index if not exists api_tenants_active_idx on public.api_tenants (is_active);

create table if not exists public.api_keys (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.api_tenants(id) on delete cascade,
  key_prefix             text not null,
  key_hash               text not null,
  key_label              text,
  scopes                 text[] not null default array[]::text[],
  is_active              boolean not null default true,
  revoked_at             timestamptz,
  last_used_at           timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint api_keys_prefix_format check (char_length(key_prefix) >= 6),
  constraint api_keys_hash_format check (char_length(key_hash) >= 64)
);

create unique index if not exists api_keys_key_hash_unique on public.api_keys (key_hash);
create unique index if not exists api_keys_key_prefix_unique on public.api_keys (key_prefix);
create index if not exists api_keys_tenant_idx on public.api_keys (tenant_id);
create index if not exists api_keys_active_idx on public.api_keys (is_active);

create table if not exists public.api_ip_allowlist (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.api_tenants(id) on delete cascade,
  cidr_block             cidr not null,
  note                   text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now()
);

create unique index if not exists api_ip_allowlist_unique
  on public.api_ip_allowlist (tenant_id, cidr_block)
  where is_active = true;

create index if not exists api_ip_allowlist_tenant_idx on public.api_ip_allowlist (tenant_id);

create table if not exists public.api_webhook_endpoints (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.api_tenants(id) on delete cascade,
  endpoint_url           text not null,
  signing_secret_hash    text not null,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists api_webhook_endpoints_url_unique
  on public.api_webhook_endpoints (tenant_id, endpoint_url)
  where is_active = true;

create table if not exists public.api_request_log (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid references public.api_tenants(id) on delete set null,
  api_key_id             uuid references public.api_keys(id) on delete set null,
  request_id             uuid,
  method                 text,
  route                  text,
  status_code            integer,
  error_code             text,
  client_ip              inet,
  latency_ms             integer,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

create index if not exists api_request_log_tenant_created_idx
  on public.api_request_log (tenant_id, created_at desc);
create index if not exists api_request_log_created_idx
  on public.api_request_log (created_at desc);

create table if not exists public.api_rate_limit_counters (
  tenant_id              uuid not null references public.api_tenants(id) on delete cascade,
  api_key_id             uuid not null references public.api_keys(id) on delete cascade,
  window_bucket          timestamptz not null,
  request_count          integer not null default 0,
  updated_at             timestamptz not null default now(),
  primary key (tenant_id, api_key_id, window_bucket)
);

create index if not exists api_rate_limit_counters_bucket_idx
  on public.api_rate_limit_counters (window_bucket);

alter table public.api_tenants enable row level security;
alter table public.api_keys enable row level security;
alter table public.api_ip_allowlist enable row level security;
alter table public.api_webhook_endpoints enable row level security;
alter table public.api_request_log enable row level security;
alter table public.api_rate_limit_counters enable row level security;

-- Service role full access (edge function runtime).
drop policy if exists api_tenants_service_role on public.api_tenants;
create policy api_tenants_service_role on public.api_tenants
  for all to service_role using (true) with check (true);

drop policy if exists api_keys_service_role on public.api_keys;
create policy api_keys_service_role on public.api_keys
  for all to service_role using (true) with check (true);

drop policy if exists api_ip_allowlist_service_role on public.api_ip_allowlist;
create policy api_ip_allowlist_service_role on public.api_ip_allowlist
  for all to service_role using (true) with check (true);

drop policy if exists api_webhook_endpoints_service_role on public.api_webhook_endpoints;
create policy api_webhook_endpoints_service_role on public.api_webhook_endpoints
  for all to service_role using (true) with check (true);

drop policy if exists api_request_log_service_role on public.api_request_log;
create policy api_request_log_service_role on public.api_request_log
  for all to service_role using (true) with check (true);

drop policy if exists api_rate_limit_counters_service_role on public.api_rate_limit_counters;
create policy api_rate_limit_counters_service_role on public.api_rate_limit_counters
  for all to service_role using (true) with check (true);

-- Optional admin read visibility for dashboard operations.
drop policy if exists api_tenants_admin_select on public.api_tenants;
create policy api_tenants_admin_select on public.api_tenants
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_keys_admin_select on public.api_keys;
create policy api_keys_admin_select on public.api_keys
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_ip_allowlist_admin_select on public.api_ip_allowlist;
create policy api_ip_allowlist_admin_select on public.api_ip_allowlist
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_webhook_endpoints_admin_select on public.api_webhook_endpoints;
create policy api_webhook_endpoints_admin_select on public.api_webhook_endpoints
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_request_log_admin_select on public.api_request_log;
create policy api_request_log_admin_select on public.api_request_log
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_rate_limit_counters_admin_select on public.api_rate_limit_counters;
create policy api_rate_limit_counters_admin_select on public.api_rate_limit_counters
  for select to authenticated using (public.is_borderpay_admin());

-- touch_updated_at trigger wiring (existing shared function).
drop trigger if exists trg_api_tenants_touch on public.api_tenants;
create trigger trg_api_tenants_touch
  before update on public.api_tenants
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_api_keys_touch on public.api_keys;
create trigger trg_api_keys_touch
  before update on public.api_keys
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_api_webhook_endpoints_touch on public.api_webhook_endpoints;
create trigger trg_api_webhook_endpoints_touch
  before update on public.api_webhook_endpoints
  for each row execute function public.touch_updated_at();

-- Helper: resolve active key + tenant runtime in one call.
create or replace function public.api_gateway_resolve_api_key(
  p_key_hash text
)
returns table (
  api_key_id uuid,
  tenant_id uuid,
  tenant_name text,
  default_mode text,
  rate_limit_per_minute integer,
  scopes text[]
)
language sql
security definer
set search_path = public
as $$
  select
    k.id,
    t.id,
    t.tenant_name,
    t.default_mode,
    t.rate_limit_per_minute,
    k.scopes
  from public.api_keys k
  join public.api_tenants t on t.id = k.tenant_id
  where k.key_hash = p_key_hash
    and k.is_active = true
    and k.revoked_at is null
    and t.is_active = true
  limit 1;
$$;

-- Helper: fail-closed IP allowlist check.
-- If a tenant has any active CIDRs, client IP must match one.
create or replace function public.api_gateway_check_ip_allowlist(
  p_tenant_id uuid,
  p_client_ip inet
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_rules boolean := false;
  v_allowed   boolean := false;
begin
  if p_client_ip is null then
    return false;
  end if;

  select exists (
    select 1
    from public.api_ip_allowlist
    where tenant_id = p_tenant_id
      and is_active = true
  ) into v_has_rules;

  if not v_has_rules then
    return true;
  end if;

  select exists (
    select 1
    from public.api_ip_allowlist
    where tenant_id = p_tenant_id
      and is_active = true
      and p_client_ip << cidr_block
  ) into v_allowed;

  return v_allowed;
end;
$$;

-- Helper: fixed-window rate limit consume.
create or replace function public.api_gateway_consume_rate_limit(
  p_tenant_id uuid,
  p_api_key_id uuid,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table(
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  current_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now               timestamptz := now();
  v_window_seconds    integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_epoch             bigint := floor(extract(epoch from v_now));
  v_bucket_epoch      bigint;
  v_bucket            timestamptz;
  v_count             integer;
  v_reset_epoch       bigint;
begin
  if p_limit is null or p_limit <= 0 then
    return query select false, 0, v_now, 0;
    return;
  end if;

  v_bucket_epoch := v_epoch - (v_epoch % v_window_seconds);
  v_bucket := to_timestamp(v_bucket_epoch);

  insert into public.api_rate_limit_counters as c (
    tenant_id,
    api_key_id,
    window_bucket,
    request_count,
    updated_at
  ) values (
    p_tenant_id,
    p_api_key_id,
    v_bucket,
    1,
    v_now
  )
  on conflict (tenant_id, api_key_id, window_bucket)
  do update
    set request_count = c.request_count + 1,
        updated_at = v_now
  returning c.request_count into v_count;

  v_reset_epoch := v_bucket_epoch + v_window_seconds;

  return query
  select
    (v_count <= p_limit) as allowed,
    greatest(p_limit - v_count, 0) as remaining,
    to_timestamp(v_reset_epoch) as reset_at,
    v_count as current_count;
end;
$$;

-- Best-effort housekeeping helper (safe no-op if no old rows).
create or replace function public.api_gateway_trim_rate_limit_counters(
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
  delete from public.api_rate_limit_counters
   where window_bucket < v_cutoff;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
