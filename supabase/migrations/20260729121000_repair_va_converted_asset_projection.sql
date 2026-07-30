-- Repair Bridge VA projection rows that were inflated by converted asset
-- settlement events. Virtual accounts are fiat/source routes; converted asset
-- delivery events are receipt/status-only and must not be added to
-- bridge_virtual_account_balances.

with bad_asset_credits as (
  select
    entity_id as bridge_virtual_account_id,
    sum(amount_minor) as bad_minor
  from public.bridge_balance_ledger
  where entity_type = 'virtual_account'
    and direction = 'credit'
    and upper(currency) in ('USDC', 'USDT', 'PYUSD', 'USDB', 'EURC')
  group by entity_id
  having sum(amount_minor) > 0
),
corrections as (
  insert into public.bridge_balance_ledger (
    event_id,
    entity_type,
    entity_id,
    user_id,
    business_user_id,
    currency,
    amount_minor,
    direction,
    balance_after_minor,
    metadata
  )
  select
    'repair:va-converted-asset-projection:' || b.bridge_virtual_account_id,
    'virtual_account',
    b.bridge_virtual_account_id,
    bvab.user_id,
    bvab.business_user_id,
    bvab.currency,
    -b.bad_minor,
    'debit',
    greatest(coalesce(bvab.available_balance_minor, 0) - b.bad_minor, 0),
    jsonb_build_object(
      'source', 'operator_repair',
      'reason', 'converted_asset_settlement_was_projected_as_virtual_account_balance',
      'bad_asset_minor_removed', b.bad_minor,
      'bad_asset_currencies', (
        select jsonb_agg(distinct upper(l.currency))
        from public.bridge_balance_ledger l
        where l.entity_type = 'virtual_account'
          and l.direction = 'credit'
          and upper(l.currency) in ('USDC', 'USDT', 'PYUSD', 'USDB', 'EURC')
          and l.entity_id = b.bridge_virtual_account_id
      )
    )
  from bad_asset_credits b
  join public.bridge_virtual_account_balances bvab
    on bvab.bridge_virtual_account_id = b.bridge_virtual_account_id
  on conflict (event_id) do nothing
  returning entity_id
)
update public.bridge_virtual_account_balances bvab
set
  available_balance_minor = greatest(coalesce(bvab.available_balance_minor, 0) - b.bad_minor, 0),
  updated_at = now()
from bad_asset_credits b
where bvab.bridge_virtual_account_id = b.bridge_virtual_account_id
  and exists (
    select 1
    from corrections c
    where c.entity_id = b.bridge_virtual_account_id
  );
