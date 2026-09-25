-- Restore the full freeze used by released BorderPay clients. No new account
-- state, screen, recovery endpoint, transfer, or automatic unlock is introduced.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.ingest_bridge_event(p_event_id text, p_event_type text, p_signature_ok boolean, p_payload jsonb, p_payload_hash text)
 RETURNS TABLE(was_duplicate boolean, was_rejected boolean, queued boolean, pending_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event_uuid uuid;
  v_pending_id uuid;
  v_now timestamptz := now();
  v_customer_id text;
  v_customer_status text;
begin
  if p_signature_ok is distinct from true then
    insert into public.bridge_webhook_events
      (event_id, event_type, signature_ok, payload, payload_hash, processing_status, last_error)
    values
      ('rejected_' || p_event_id || '_' || extract(epoch from v_now)::bigint::text,
       'signature_rejected', false, p_payload, p_payload_hash, 'rejected',
       'RSA-SHA256 signature verification failed')
    on conflict (event_id) do nothing;
    return query select false::boolean, true::boolean, false::boolean, null::uuid;
    return;
  end if;

  insert into public.bridge_webhook_events
    (event_id, event_type, signature_ok, payload, payload_hash, processing_status, received_at)
  values
    (p_event_id, p_event_type, true, p_payload, p_payload_hash, 'received', v_now)
  on conflict (event_id) do nothing
  returning id into v_event_uuid;

  if v_event_uuid is null then
    return query select true::boolean, false::boolean, false::boolean, null::uuid;
    return;
  end if;

  -- Reuse the existing account freeze before acknowledging a verified pause.
  -- This is in the SAME transaction as ingest and queue insertion. A queue
  -- failure rolls the freeze back and Bridge must retry the unacknowledged event.
  -- Only a customer status event can freeze a customer; transfer/VA pauses cannot.
  if p_event_type in ('customer.updated.status_transitioned', 'customer.updated') then
    v_customer_id := coalesce(nullif(p_payload->>'event_object_id', ''),
      nullif(p_payload#>>'{event_object,id}', ''), nullif(p_payload#>>'{data,id}', ''));
    v_customer_status := lower(btrim(coalesce(nullif(p_payload->>'event_object_status', ''),
      p_payload#>>'{event_object,status}', p_payload#>>'{data,status}', '')));
    if v_customer_status = 'paused' and v_customer_id is not null then
      update public.user_profiles up
      set account_status = case
            when lower(coalesce(up.account_status, '')) in ('closed','offboarded','terminated','deactivated','rejected')
              then up.account_status else 'frozen' end,
          account_frozen_at = coalesce(up.account_frozen_at, up.bridge_account_paused_at, v_now),
          account_frozen_reason = coalesce(nullif(up.account_frozen_reason, ''), 'Bridge account paused'),
          bridge_account_status = 'paused',
          bridge_account_paused_at = coalesce(up.bridge_account_paused_at, v_now),
          updated_at = v_now
      where v_customer_id = case when up.account_type = 'business' then
        coalesce((select nullif(bp.bridge_customer_id, '') from public.business_profiles bp
          where bp.user_id = up.id), up.bridge_customer_id)
        else up.bridge_customer_id end;
    end if;
  end if;

  -- Queue parent log. pending_events.event_id FK -> webhook_logs(event_id), and
  -- the worker (complete_pending_event / fail_pending_event) updates
  -- webhook_logs by this same event_id. Create it BEFORE pending_events, keyed
  -- by the SAME queue id ('bridge:' || p_event_id).
  insert into public.webhook_logs
    (event_id, source, event_type, status, signature_ok, payload_hash, received_at, queued_at)
  values
    ('bridge:' || p_event_id, 'bridge', p_event_type, 'queued', true, p_payload_hash, v_now, v_now)
  on conflict (event_id) do nothing;

  insert into public.pending_events
    (event_id, source, event_type, payload, status)
  values
    ('bridge:' || p_event_id, 'bridge', p_event_type, p_payload, 'queued')
  returning id into v_pending_id;

  update public.bridge_webhook_events
     set processing_status = 'queued',
         queued_at         = v_now,
         pending_event_id  = v_pending_id
   where id = v_event_uuid;

  update public.webhook_logs
     set pending_event_id = v_pending_id
   where event_id = 'bridge:' || p_event_id;

  return query select false::boolean, false::boolean, true::boolean, v_pending_id;
end;
$function$;

revoke all on function public.ingest_bridge_event(text,text,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_bridge_event(text,text,boolean,jsonb,text) to service_role;

-- Retain the RPC signature for released clients, but withdraw the optional
-- receiving-only workspace. No wallet balances or deposit instructions escape.
create or replace function public.paused_account_wallet_summary()
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.user_profiles where id=auth.uid()) then
    raise exception 'PROFILE_UNAVAILABLE';
  end if;
  return jsonb_build_object('mode','locked');
end;
$$;
revoke all on function public.paused_account_wallet_summary() from public,anon;
grant execute on function public.paused_account_wallet_summary() to authenticated;

-- Reuse the existing compliance-field guard. A SECURITY DEFINER function's
-- current_user is its owner, not the caller; it must not exempt every customer.
CREATE OR REPLACE FUNCTION public.guard_user_profile_compliance_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.role(), '');
  v_is_admin boolean := false;
begin
  if v_role = 'service_role' or (v_role = '' and session_user in ('postgres', 'supabase_admin')) then
    return new;
  end if;

  begin
    v_is_admin := public.is_borderpay_admin();
  exception when others then
    v_is_admin := false;
  end;
  if v_is_admin then
    return new;
  end if;

  if new.account_status is distinct from old.account_status
     or new.account_frozen_at is distinct from old.account_frozen_at
     or new.account_frozen_reason is distinct from old.account_frozen_reason
     or new.account_frozen_by is distinct from old.account_frozen_by
     or new.bridge_account_status is distinct from old.bridge_account_status
     or new.bridge_account_paused_at is distinct from old.bridge_account_paused_at
  then
    raise exception using
      errcode = '42501',
      message = 'Compliance-managed account status fields cannot be changed by the customer.';
  end if;

  return new;
end;
$function$;

-- Restore only Bridge-paused profiles that still have the receiving-only
-- eligibility states. Preserve existing fraud reasons, dates, and stronger locks.
update public.user_profiles
set account_status='frozen',
    account_frozen_at=coalesce(account_frozen_at,bridge_account_paused_at,now()),
    account_frozen_reason=coalesce(nullif(account_frozen_reason,''),'Bridge account paused'),
    updated_at=now()
where lower(btrim(coalesce(bridge_account_status,'')))='paused'
  and lower(btrim(coalesce(account_status,''))) in ('active','approved','pending_kyc');
commit;
