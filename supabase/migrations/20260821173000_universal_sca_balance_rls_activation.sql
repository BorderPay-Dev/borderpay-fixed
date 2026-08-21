-- Activate universal SCA for authenticated balance reads only after the SCA
-- issuer, grant endpoint and compatible clients are deployed.
-- Admin and service-role policies remain unchanged.

drop policy if exists bw_owner_read on public.bridge_wallets;
create policy bw_owner_read on public.bridge_wallets for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.has_fresh_sca_wallet_access(auth.uid())
  );
drop policy if exists bva_owner_read on public.bridge_virtual_accounts;
create policy bva_owner_read on public.bridge_virtual_accounts for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.has_fresh_sca_wallet_access(auth.uid())
  );

drop policy if exists bbl_owner_read on public.bridge_balance_ledger;
create policy bbl_owner_read on public.bridge_balance_ledger for select to authenticated
  using (
    (user_id = auth.uid() or business_user_id = auth.uid())
    and public.has_fresh_sca_wallet_access(auth.uid())
  );
