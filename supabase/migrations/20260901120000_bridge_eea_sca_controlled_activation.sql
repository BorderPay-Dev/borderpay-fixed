-- Bridge EEA SCA database rollout control and activation preflight.
-- Default is disabled. Enabling requires Bridge approval, compatible clients,
-- and zero missing provider-scope observations for verified Bridge customers.

create table if not exists public.bridge_eea_sca_runtime_control (
  singleton boolean primary key default true check (singleton),
  enforcement_enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check ((not enforcement_enabled) or (enabled_at is not null and enabled_by is not null))
);

insert into public.bridge_eea_sca_runtime_control (singleton, enforcement_enabled)
values (true, false)
on conflict (singleton) do nothing;

alter table public.bridge_eea_sca_runtime_control enable row level security;
revoke all on public.bridge_eea_sca_runtime_control from public, anon, authenticated;
grant select, insert, update on public.bridge_eea_sca_runtime_control to service_role;

create or replace function public.can_read_bridge_financial_data(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enforcement_enabled boolean := false;
  v_account_type text;
  v_customer_id text;
  v_approved boolean := false;
  v_scope_required boolean;
begin
  if p_user_id is null or p_user_id <> (select auth.uid()) then return false; end if;
  if public.is_borderpay_admin() then return true; end if;

  select enforcement_enabled into v_enforcement_enabled
    from public.bridge_eea_sca_runtime_control
   where singleton = true;

  -- Fail open only while the explicit release control remains disabled. This
  -- prevents a partially populated scope cache from locking existing users.
  if not coalesce(v_enforcement_enabled, false) then return true; end if;

  select up.account_type,
         case when up.account_type = 'business'
           then coalesce(bp.bridge_customer_id, up.bridge_customer_id)
           else up.bridge_customer_id
         end,
         case when up.account_type = 'business'
           then lower(coalesce(bp.bridge_kyb_status, '')) = 'approved'
           else lower(coalesce(up.bridge_kyc_status, '')) = 'approved'
         end
    into v_account_type, v_customer_id, v_approved
    from public.user_profiles up
    left join public.business_profiles bp on bp.user_id = up.id
   where up.id = p_user_id;

  if not found then return false; end if;
  if not v_approved then return true; end if;
  if v_customer_id is null or btrim(v_customer_id) = '' then return false; end if;

  select scope.sca_required
    into v_scope_required
    from public.sca_customer_scopes scope
   where scope.user_id = p_user_id
     and scope.bridge_customer_id = v_customer_id
     and scope.source = 'bridge_customer_api'
     and scope.expires_at > now();

  if not found then return false; end if;
  if not v_scope_required then return true; end if;
  return public.has_fresh_sca_wallet_access(p_user_id);
end;
$$;

revoke all on function public.can_read_bridge_financial_data(uuid) from public, anon;
grant execute on function public.can_read_bridge_financial_data(uuid) to authenticated, service_role;

create or replace function public.bridge_eea_sca_activation_preflight()
returns table (
  verified_bridge_customers bigint,
  fresh_provider_scopes bigint,
  missing_or_expired_scopes bigint,
  verified_eea_customers bigint,
  verified_non_eea_customers bigint,
  ready boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with customers as (
    select up.id as user_id,
           case when up.account_type = 'business'
             then coalesce(bp.bridge_customer_id, up.bridge_customer_id)
             else up.bridge_customer_id
           end as bridge_customer_id
      from public.user_profiles up
      left join public.business_profiles bp on bp.user_id = up.id
     where case when up.account_type = 'business'
       then lower(coalesce(bp.bridge_kyb_status, '')) = 'approved'
       else lower(coalesce(up.bridge_kyc_status, '')) = 'approved'
     end
  ), scoped as (
    select c.user_id, c.bridge_customer_id, s.sca_required,
           (s.user_id is not null and s.source = 'bridge_customer_api' and s.expires_at > now()) as fresh
      from customers c
      left join public.sca_customer_scopes s
        on s.user_id = c.user_id and s.bridge_customer_id = c.bridge_customer_id
  )
  select count(*) filter (where bridge_customer_id is not null and btrim(bridge_customer_id) <> ''),
         count(*) filter (where fresh),
         count(*) filter (where bridge_customer_id is null or btrim(bridge_customer_id) = '' or not fresh),
         count(*) filter (where fresh and sca_required),
         count(*) filter (where fresh and not sca_required),
         count(*) filter (where bridge_customer_id is null or btrim(bridge_customer_id) = '' or not fresh) = 0
    from scoped;
$$;

revoke all on function public.bridge_eea_sca_activation_preflight() from public, anon, authenticated;
grant execute on function public.bridge_eea_sca_activation_preflight() to service_role;

comment on table public.bridge_eea_sca_runtime_control is
  'Fail-safe release control. Keep disabled until Bridge approval and a zero-blocker provider-scope preflight.';
comment on function public.bridge_eea_sca_activation_preflight() is
  'Service-role readiness report; enforcement must not be enabled while missing_or_expired_scopes is nonzero.';
