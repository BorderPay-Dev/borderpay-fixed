-- Customer wallet reads are limited to the supported Base assets. Provider
-- history remains intact and is still visible to administrators/service jobs.

drop policy if exists bw_owner_read on public.bridge_wallets;
create policy bw_owner_read on public.bridge_wallets
for select to authenticated
using (
  (auth.uid() = user_id or auth.uid() = business_user_id)
  and public.can_read_bridge_financial_data(auth.uid())
  and lower(coalesce(chain, '')) = 'base'
  and upper(coalesce(currency, '')) in ('USDC', 'EURC')
);

drop policy if exists bbl_owner_read on public.bridge_balance_ledger;
create policy bbl_owner_read on public.bridge_balance_ledger
for select to authenticated
using (
  (auth.uid() = user_id or auth.uid() = business_user_id)
  and upper(coalesce(currency, '')) <> 'USDT'
);

drop policy if exists wallets_own on public.wallets;
create policy wallets_own on public.wallets
for all to public
using (
  auth.uid() = user_id
  and upper(coalesce(currency, '')) <> 'USDT'
)
with check (
  auth.uid() = user_id
  and upper(coalesce(currency, '')) <> 'USDT'
);
