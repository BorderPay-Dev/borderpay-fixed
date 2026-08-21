-- Keep owner balance reads compatible with already-published mobile clients.
-- Universal SCA remains available to the new web client, but database-level
-- enforcement must be reactivated only after compatible App Store and Play
-- builds are released.

drop policy if exists bw_owner_read on public.bridge_wallets;
create policy bw_owner_read on public.bridge_wallets for select to authenticated
  using (user_id = auth.uid() or business_user_id = auth.uid());
drop policy if exists bva_owner_read on public.bridge_virtual_accounts;
create policy bva_owner_read on public.bridge_virtual_accounts for select to authenticated
  using (user_id = auth.uid() or business_user_id = auth.uid());

drop policy if exists bbl_owner_read on public.bridge_balance_ledger;
create policy bbl_owner_read on public.bridge_balance_ledger for select to authenticated
  using (user_id = auth.uid() or business_user_id = auth.uid());
