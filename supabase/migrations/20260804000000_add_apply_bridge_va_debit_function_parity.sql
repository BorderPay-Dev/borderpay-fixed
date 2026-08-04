-- Idempotent VA debit/reversal used for Bridge refund/cancel activity events.
-- The amount parameter is positive; the ledger row stores the applied debit as
-- a negative amount_minor and never lets the projected balance go below zero.

create or replace function public.apply_bridge_va_debit(
  p_event_id              text,
  p_bridge_va_id          text,
  p_user_id               uuid,
  p_business_user_id      uuid,
  p_currency              text,
  p_amount_minor          bigint,
  p_metadata              jsonb default '{}'::jsonb
)
returns table (
  applied              boolean,
  debited_amount_minor bigint,
  new_balance_minor    bigint,
  balance_row_id       uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ledger_id      uuid;
  v_balance_id     uuid;
  v_current        bigint;
  v_debited        bigint;
  v_new_balance    bigint;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'apply_bridge_va_debit: p_amount_minor must be a positive integer (got %)', p_amount_minor;
  end if;
  if p_user_id is null and p_business_user_id is null then
    raise exception 'apply_bridge_va_debit: one of p_user_id / p_business_user_id is required';
  end if;
  if p_user_id is not null and p_business_user_id is not null then
    raise exception 'apply_bridge_va_debit: only one of p_user_id / p_business_user_id may be set';
  end if;

  insert into public.bridge_virtual_account_balances (
    bridge_virtual_account_id, user_id, business_user_id, currency,
    available_balance_minor, pending_balance_minor
  ) values (
    p_bridge_va_id, p_user_id, p_business_user_id, upper(p_currency), 0, 0
  )
  on conflict (bridge_virtual_account_id) do nothing;

  select id, available_balance_minor
    into v_balance_id, v_current
    from public.bridge_virtual_account_balances
   where bridge_virtual_account_id = p_bridge_va_id
   for update;

  v_debited := least(coalesce(v_current, 0), p_amount_minor);
  v_new_balance := greatest(coalesce(v_current, 0) - v_debited, 0);

  insert into public.bridge_balance_ledger (
    event_id, entity_type, entity_id, user_id, business_user_id,
    currency, amount_minor, direction, balance_after_minor, metadata
  ) values (
    p_event_id, 'virtual_account', p_bridge_va_id, p_user_id, p_business_user_id,
    upper(p_currency), -v_debited, 'debit', v_new_balance, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (event_id) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select id, available_balance_minor
      into v_balance_id, v_new_balance
      from public.bridge_virtual_account_balances
     where bridge_virtual_account_id = p_bridge_va_id;
    return query select false::boolean, 0::bigint, v_new_balance, v_balance_id;
    return;
  end if;

  update public.bridge_virtual_account_balances
     set available_balance_minor = v_new_balance,
         updated_at              = now()
   where bridge_virtual_account_id = p_bridge_va_id
   returning id, available_balance_minor
     into v_balance_id, v_new_balance;

  return query select true::boolean, v_debited, v_new_balance, v_balance_id;
end;
$$;

revoke all on function public.apply_bridge_va_debit(text, text, uuid, uuid, text, bigint, jsonb) from public;
grant execute on function public.apply_bridge_va_debit(text, text, uuid, uuid, text, bigint, jsonb) to service_role;
