-- Step 2J: closed-beta guardrails for public API rollout.
-- Adds tenant-level allowlist flag + optional single-transfer cap.

alter table public.api_tenants
  add column if not exists beta_access_enabled boolean not null default false;

alter table public.api_tenants
  add column if not exists max_single_transfer_usd numeric(18,2);

alter table public.api_tenants
  drop constraint if exists api_tenants_max_single_transfer_usd_check;

alter table public.api_tenants
  add constraint api_tenants_max_single_transfer_usd_check
  check (max_single_transfer_usd is null or max_single_transfer_usd >= 1.00);

create index if not exists api_tenants_beta_access_idx
  on public.api_tenants (beta_access_enabled);

create or replace function public.api_gateway_resolve_api_key(
  p_key_hash text
)
returns table (
  api_key_id uuid,
  tenant_id uuid,
  tenant_name text,
  default_mode text,
  rate_limit_per_minute integer,
  beta_access_enabled boolean,
  max_single_transfer_usd numeric,
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
    t.beta_access_enabled,
    t.max_single_transfer_usd,
    k.scopes
  from public.api_keys k
  join public.api_tenants t on t.id = k.tenant_id
  where k.key_hash = p_key_hash
    and k.is_active = true
    and k.revoked_at is null
    and t.is_active = true
  limit 1;
$$;
