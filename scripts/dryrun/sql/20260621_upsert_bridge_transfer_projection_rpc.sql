-- DRY-RUN PACKAGE: Canonical bridge_transfers projection RPC
-- -----------------------------------------------------------------------------
-- IMPORTANT: Intentionally blocked by default. Remove guard only with explicit
-- approval in a deployment window.

do $$
begin
  raise exception 'DRY_RUN_ONLY: remove guard in 20260621_upsert_bridge_transfer_projection_rpc.sql before execution';
end
$$;

begin;

create or replace function public.upsert_bridge_transfer_projection(
  p_bridge_transfer_id text,
  p_user_id uuid,
  p_business_user_id uuid,
  p_source_type text,
  p_destination_type text,
  p_amount numeric,
  p_currency text,
  p_state text,
  p_raw jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
begin
  if p_bridge_transfer_id is null or length(trim(p_bridge_transfer_id)) = 0 then
    raise exception 'upsert_bridge_transfer_projection: p_bridge_transfer_id is required';
  end if;

  insert into public.bridge_transfers (
    bridge_transfer_id,
    user_id,
    business_user_id,
    source_type,
    destination_type,
    amount,
    currency,
    state,
    raw,
    updated_at
  ) values (
    p_bridge_transfer_id,
    p_user_id,
    p_business_user_id,
    coalesce(nullif(trim(p_source_type), ''), 'external_bank'),
    coalesce(nullif(trim(p_destination_type), ''), 'external_bank'),
    coalesce(p_amount, 0),
    upper(coalesce(nullif(trim(p_currency), ''), 'USD')),
    lower(coalesce(nullif(trim(p_state), ''), 'pending')),
    coalesce(p_raw, '{}'::jsonb),
    now()
  )
  on conflict (bridge_transfer_id)
  do update set
    user_id          = excluded.user_id,
    business_user_id = excluded.business_user_id,
    source_type      = excluded.source_type,
    destination_type = excluded.destination_type,
    amount           = excluded.amount,
    currency         = excluded.currency,
    state            = excluded.state,
    raw              = excluded.raw,
    updated_at       = now()
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.upsert_bridge_transfer_projection(text, uuid, uuid, text, text, numeric, text, text, jsonb) from public;
grant execute on function public.upsert_bridge_transfer_projection(text, uuid, uuid, text, text, numeric, text, text, jsonb) to service_role;

commit;

-- Verification
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
-- where n.nspname='public' and proname='upsert_bridge_transfer_projection';
