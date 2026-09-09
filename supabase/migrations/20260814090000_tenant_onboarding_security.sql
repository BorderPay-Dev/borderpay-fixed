-- Tenant-aware onboarding controls. Additive: no existing user, wallet,
-- account, KYC, transaction, balance, or ownership row is rewritten.

create table if not exists public.api_tenant_end_users (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.api_tenants(id) on delete restrict,
  user_id            uuid not null references auth.users(id) on delete cascade,
  external_user_id   text not null,
  account_type       public.account_type not null,
  onboarding_channel text not null check (onboarding_channel in ('api','white_label')),
  created_at         timestamptz not null default now(),
  unique (user_id),
  unique (tenant_id, external_user_id)
);

create index if not exists api_tenant_end_users_tenant_created_idx
  on public.api_tenant_end_users (tenant_id, created_at desc);

create table if not exists public.api_onboarding_authorizations (
  id                    uuid primary key,
  tenant_id             uuid not null references public.api_tenants(id) on delete restrict,
  api_key_id             uuid not null references public.api_keys(id) on delete restrict,
  token_hash             text not null unique check (char_length(token_hash) = 64),
  external_user_id       text not null,
  allowed_account_types  public.account_type[] not null,
  onboarding_channel    text not null check (onboarding_channel in ('api','white_label')),
  expires_at             timestamptz not null,
  used_at                timestamptz,
  used_by_user_id        uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  check (cardinality(allowed_account_types) > 0),
  check (expires_at > created_at)
);

create index if not exists api_onboarding_authorizations_tenant_created_idx
  on public.api_onboarding_authorizations (tenant_id, created_at desc);
create index if not exists api_onboarding_authorizations_live_idx
  on public.api_onboarding_authorizations (token_hash, expires_at)
  where used_at is null;

create table if not exists public.api_onboarding_audit (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid references public.api_tenants(id) on delete set null,
  api_key_id         uuid references public.api_keys(id) on delete set null,
  authorization_id   uuid references public.api_onboarding_authorizations(id) on delete set null,
  user_id            uuid references auth.users(id) on delete set null,
  external_user_id   text,
  event_type         text not null check (event_type in (
    'authorization_issued','authorization_consumed','signup_completed','signup_failed'
  )),
  account_type       public.account_type,
  onboarding_channel text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists api_onboarding_audit_tenant_created_idx
  on public.api_onboarding_audit (tenant_id, created_at desc);
create index if not exists api_onboarding_audit_user_created_idx
  on public.api_onboarding_audit (user_id, created_at desc)
  where user_id is not null;

alter table public.api_tenant_end_users enable row level security;
alter table public.api_onboarding_authorizations enable row level security;
alter table public.api_onboarding_audit enable row level security;
-- These legacy profile mirrors predate migration-managed RLS. The onboarding
-- boundary is incomplete on a fresh rebuild unless RLS is enabled explicitly;
-- later policy replacement below then preserves owner reads while preventing
-- direct profile insertion as a signup bypass.
alter table public.user_profiles enable row level security;
alter table public.users enable row level security;

-- The gateway runtime already consumes tenant_metadata, but the last database
-- resolver migration did not return it. Keep the RPC contract aligned so
-- onboarding policy is evaluated from the authenticated API key's tenant.
drop function if exists public.api_gateway_resolve_api_key(text);
create function public.api_gateway_resolve_api_key(
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
  tenant_metadata jsonb,
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
    coalesce(t.metadata, '{}'::jsonb),
    k.scopes
  from public.api_keys k
  join public.api_tenants t on t.id = k.tenant_id
  where k.key_hash = p_key_hash
    and k.is_active = true
    and k.revoked_at is null
    and t.is_active = true
  limit 1;
$$;

revoke all on function public.api_gateway_resolve_api_key(text) from public, anon, authenticated;
grant execute on function public.api_gateway_resolve_api_key(text) to service_role;

drop policy if exists api_tenant_end_users_service_role on public.api_tenant_end_users;
create policy api_tenant_end_users_service_role on public.api_tenant_end_users
  for all to service_role using (true) with check (true);
drop policy if exists api_tenant_end_users_admin_read on public.api_tenant_end_users;
create policy api_tenant_end_users_admin_read on public.api_tenant_end_users
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_onboarding_authorizations_service_role on public.api_onboarding_authorizations;
create policy api_onboarding_authorizations_service_role on public.api_onboarding_authorizations
  for all to service_role using (true) with check (true);
drop policy if exists api_onboarding_authorizations_admin_read on public.api_onboarding_authorizations;
create policy api_onboarding_authorizations_admin_read on public.api_onboarding_authorizations
  for select to authenticated using (public.is_borderpay_admin());

drop policy if exists api_onboarding_audit_service_role on public.api_onboarding_audit;
create policy api_onboarding_audit_service_role on public.api_onboarding_audit
  for all to service_role using (true) with check (true);
drop policy if exists api_onboarding_audit_admin_read on public.api_onboarding_audit;
create policy api_onboarding_audit_admin_read on public.api_onboarding_audit
  for select to authenticated using (public.is_borderpay_admin());

-- Atomic single-use reservation. Only service-role runtimes may execute it.
create or replace function public.consume_api_onboarding_authorization(
  p_token_hash text,
  p_account_type public.account_type
)
returns table (
  authorization_id uuid,
  tenant_id uuid,
  api_key_id uuid,
  external_user_id text,
  onboarding_channel text,
  allowed_account_types public.account_type[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_onboarding_authorizations%rowtype;
begin
  update public.api_onboarding_authorizations a
     set used_at = now()
   where a.token_hash = p_token_hash
     and a.used_at is null
     and a.expires_at > now()
     and p_account_type = any(a.allowed_account_types)
     and exists (
       select 1 from public.api_tenants t
        where t.id = a.tenant_id and t.is_active = true
     )
     and exists (
       select 1 from public.api_keys k
        where k.id = a.api_key_id
          and k.tenant_id = a.tenant_id
          and k.is_active = true
          and k.revoked_at is null
     )
  returning a.* into v_row;

  if not found then return; end if;

  insert into public.api_onboarding_audit (
    tenant_id, api_key_id, authorization_id, external_user_id,
    event_type, account_type, onboarding_channel
  ) values (
    v_row.tenant_id, v_row.api_key_id, v_row.id, v_row.external_user_id,
    'authorization_consumed', p_account_type, v_row.onboarding_channel
  );

  return query select v_row.id, v_row.tenant_id, v_row.api_key_id,
    v_row.external_user_id, v_row.onboarding_channel, v_row.allowed_account_types;
end;
$$;

revoke all on function public.consume_api_onboarding_authorization(text, public.account_type) from public, anon, authenticated;
grant execute on function public.consume_api_onboarding_authorization(text, public.account_type) to service_role;

-- Direct BorderPay policy. Missing Individual policy is treated as disabled in
-- auth-signup. The cutoff is written once at migration time and never advanced.
insert into public.app_config (key, value, description)
values
  ('direct_individual_signup_enabled', 'false', 'Allow new direct BorderPay individual accounts'),
  ('direct_business_signup_enabled', 'true', 'Allow new direct BorderPay business accounts')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description;

insert into public.app_config (key, value, description)
values (
  'individual_signup_legacy_cutoff', now()::text,
  'Auth identities created before this timestamp may use legacy missing-profile KYC repair'
)
on conflict (key) do nothing;

-- Owners retain read/update/delete of their existing profile rows, but cannot
-- fabricate a missing profile. Legitimate creation is service-role only.
drop policy if exists profiles_own on public.user_profiles;
drop policy if exists profiles_owner_select on public.user_profiles;
drop policy if exists profiles_owner_update on public.user_profiles;
drop policy if exists profiles_owner_delete on public.user_profiles;
create policy profiles_owner_select on public.user_profiles
  for select to authenticated using (auth.uid() = id);
create policy profiles_owner_update on public.user_profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_owner_delete on public.user_profiles
  for delete to authenticated using (auth.uid() = id);

drop policy if exists users_own on public.users;
drop policy if exists users_owner_select on public.users;
drop policy if exists users_owner_update on public.users;
drop policy if exists users_owner_delete on public.users;
create policy users_owner_select on public.users
  for select to authenticated using (auth.uid() = id);
create policy users_owner_update on public.users
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy users_owner_delete on public.users
  for delete to authenticated using (auth.uid() = id);
