-- Provider-authoritative EEA SCA scope for customer financial reads.
--
-- The compatible rollout only restricts customers whose EEA scope has already
-- been established by sca-authorize from Bridge's Customer API. New clients
-- fail closed in their preflight while scope is unknown. Existing mobile
-- clients remain readable until compatible store builds are released, after
-- which a separate activation migration can make unknown scope fail closed.

create table if not exists public.sca_customer_scopes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bridge_customer_id text not null,
  provider_country text not null check (provider_country ~ '^[A-Z]{2}$'),
  sca_required boolean not null,
  source text not null check (source = 'bridge_customer_api'),
  checked_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > checked_at and expires_at <= checked_at + interval '24 hours')
);

create unique index if not exists sca_customer_scopes_bridge_customer_idx
  on public.sca_customer_scopes (bridge_customer_id);

alter table public.sca_customer_scopes enable row level security;
revoke all on public.sca_customer_scopes from public, anon, authenticated;

drop policy if exists sca_customer_scopes_service_role on public.sca_customer_scopes;
create policy sca_customer_scopes_service_role on public.sca_customer_scopes
  for all to service_role using (true) with check (true);

create or replace function public.can_read_bridge_financial_data(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_type text;
  v_customer_id text;
  v_approved boolean := false;
  v_scope_required boolean;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    return false;
  end if;

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

  -- Compatibility stage: published mobile clients do not yet perform the
  -- provider-scope preflight. Do not lock those users globally. The new client
  -- itself fails closed until this authoritative observation exists.
  if not found then return true; end if;
  if not v_scope_required then return true; end if;
  return public.has_fresh_sca_wallet_access(p_user_id);
end;
$$;

revoke all on function public.can_read_bridge_financial_data(uuid) from public, anon;
grant execute on function public.can_read_bridge_financial_data(uuid) to authenticated, service_role;

drop policy if exists bw_owner_read on public.bridge_wallets;
create policy bw_owner_read on public.bridge_wallets for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.can_read_bridge_financial_data(auth.uid())
  );

drop policy if exists bva_owner_read on public.bridge_virtual_accounts;
create policy bva_owner_read on public.bridge_virtual_accounts for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.can_read_bridge_financial_data(auth.uid())
  );

drop policy if exists bvab_owner_read on public.bridge_virtual_account_balances;
create policy bvab_owner_read on public.bridge_virtual_account_balances for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.can_read_bridge_financial_data(auth.uid())
  );

drop policy if exists bbl_owner_read on public.bridge_balance_ledger;
create policy bbl_owner_read on public.bridge_balance_ledger for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.can_read_bridge_financial_data(auth.uid())
  );

drop policy if exists bt_owner_read on public.bridge_transfers;
create policy bt_owner_read on public.bridge_transfers for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.can_read_bridge_financial_data(auth.uid())
  );

-- Transaction history is an explicit SCA-protected account-access surface.
-- This restrictive policy composes with every existing permissive policy, so
-- a later read policy cannot accidentally bypass the SCA decision.
alter table public.transactions enable row level security;
drop policy if exists transactions_owner_read_sca on public.transactions;
create policy transactions_owner_read_sca on public.transactions
  for select to authenticated
  using (user_id = auth.uid());
drop policy if exists transactions_sca_read_guard on public.transactions;
create policy transactions_sca_read_guard on public.transactions
  as restrictive for select to authenticated
  using (public.can_read_bridge_financial_data(auth.uid()));

comment on table public.sca_customer_scopes is
  'Short-lived Bridge Customer API observations used to apply EEA SCA without imposing it on non-EEA users.';
