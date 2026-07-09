-- One-time production repair: remove duplicate wallet ledger rows created with
-- event_id='bridge:<webhook_event_id>' when the canonical '<webhook_event_id>'
-- row already exists for the same wallet/currency/direction/amount.
--
-- Safety:
-- Deletes only prefixed duplicates with a matching canonical row. The canonical
-- worker writes raw Bridge webhook event IDs to bridge_balance_ledger.event_id.

delete from public.bridge_balance_ledger prefixed
where prefixed.entity_type = 'wallet'
  and prefixed.event_id like 'bridge:wh_%'
  and exists (
    select 1
    from public.bridge_balance_ledger canonical
    where canonical.entity_type = prefixed.entity_type
      and canonical.entity_id = prefixed.entity_id
      and canonical.currency = prefixed.currency
      and canonical.direction = prefixed.direction
      and canonical.amount_minor = abs(prefixed.amount_minor)
      and canonical.event_id = replace(prefixed.event_id, 'bridge:', '')
  );
