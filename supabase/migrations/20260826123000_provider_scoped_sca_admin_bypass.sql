-- Keep authenticated BorderPay operators functional while customer financial
-- reads are protected by provider-scoped EEA SCA policies.

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

  if public.is_borderpay_admin() then
    return true;
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

  -- Compatibility stage for already-published mobile clients. New clients
  -- fail closed before issuing reads until provider scope is established.
  if not found then return true; end if;
  if not v_scope_required then return true; end if;
  return public.has_fresh_sca_wallet_access(p_user_id);
end;
$$;

revoke all on function public.can_read_bridge_financial_data(uuid) from public, anon;
grant execute on function public.can_read_bridge_financial_data(uuid) to authenticated, service_role;
