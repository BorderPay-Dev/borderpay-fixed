-- Certification-critical mutation ledger.
--
-- This is a compensating control for hosted environments where session-level
-- pgaudit configuration is unavailable. It does not claim that a database
-- administrator is technically incapable of disabling the control. Instead,
-- every observed row mutation is sequenced and hash chained, then must receive
-- a signed receipt from an independently operated append-only sink before the
-- certification verifier will accept the capture window.

create extension if not exists pgcrypto;

create table if not exists public.certification_audit_chain_state (
  singleton boolean primary key default true check (singleton),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_hash text not null default repeat('0', 64)
    check (last_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

insert into public.certification_audit_chain_state (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.certification_audit_events (
  sequence_no bigint primary key check (sequence_no > 0),
  event_id uuid not null unique default gen_random_uuid(),
  occurred_at timestamptz not null,
  schema_name text not null,
  table_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE','TRUNCATE','MARKER')),
  record_key text,
  changed_fields text[] not null default '{}',
  actor jsonb not null,
  old_values jsonb,
  new_values jsonb,
  chain_payload text not null,
  previous_hash text not null check (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null unique check (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.certification_audit_deliveries (
  event_id uuid primary key references public.certification_audit_events(event_id) on delete restrict,
  sequence_no bigint not null unique references public.certification_audit_events(sequence_no) on delete restrict,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  receipt_id text unique,
  sink_key_id text,
  signed_receipt text,
  stored_at timestamptz,
  retention_until timestamptz,
  object_lock_mode text,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.certification_audit_chain_state enable row level security;
alter table public.certification_audit_events enable row level security;
alter table public.certification_audit_deliveries enable row level security;

revoke all on public.certification_audit_chain_state from public, anon, authenticated, service_role;
revoke all on public.certification_audit_events from public, anon, authenticated, service_role;
revoke all on public.certification_audit_deliveries from public, anon, authenticated, service_role;

create or replace function public.certification_audit_changed_fields(old_row jsonb, new_row jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(key order by key), '{}'::text[])
  from (
    select key from jsonb_object_keys(coalesce(old_row, '{}'::jsonb)) key
    union
    select key from jsonb_object_keys(coalesce(new_row, '{}'::jsonb)) key
  ) keys
  where old_row -> key is distinct from new_row -> key;
$$;

create or replace function public.certification_audit_safe_values(
  relation_name text,
  row_value jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  allowed_keys text[];
begin
  if row_value is null then return null; end if;
  case relation_name
    when 'auth.users' then
      allowed_keys := array['id','email_confirmed_at','created_at','updated_at','deleted_at','is_sso_user','is_anonymous'];
    when 'public.user_profiles' then
      allowed_keys := array['id','user_id','account_type','bridge_customer_id','status','is_active','created_at','updated_at'];
    when 'public.business_profiles' then
      allowed_keys := array['id','user_id','bridge_customer_id','bridge_kyb_status','business_verification_status','created_at','updated_at'];
    when 'public.account_origin_provenance' then
      allowed_keys := array['user_id','account_type','origin_kind','onboarding_channel','source_path','account_created_at','recorded_at','tenant_id','api_key_id','authorization_id','external_user_id','source_reference'];
    when 'public.operator_bridge_accounts' then
      allowed_keys := array['id','user_id','bridge_customer_id','active','created_at','updated_at'];
    when 'public.bridge_wallets' then
      allowed_keys := array['id','user_id','business_user_id','bridge_customer_id','bridge_wallet_id','currency','chain','address','status','created_at','updated_at'];
    when 'public.bridge_virtual_accounts' then
      allowed_keys := array['id','user_id','business_user_id','bridge_customer_id','bridge_virtual_account_id','currency','rail','status','created_at','updated_at'];
    when 'public.bridge_external_accounts' then
      allowed_keys := array['id','user_id','business_user_id','bridge_customer_id','bridge_external_account_id','currency','status','created_at','updated_at'];
    when 'public.wallets' then
      allowed_keys := array['id','user_id','currency','balance','status','created_at','updated_at'];
    when 'public.transactions' then
      allowed_keys := array['id','user_id','type','amount','currency','status','provider','provider_transaction_id','created_at','updated_at'];
    else
      return '{}'::jsonb;
  end case;
  return coalesce((
    select jsonb_object_agg(entry.key, entry.value)
    from jsonb_each(row_value) entry
    where entry.key = any(allowed_keys)
  ), '{}'::jsonb);
end;
$$;

create or replace function public.certification_audit_actor()
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims jsonb := '{}'::jsonb;
begin
  begin
    claims := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    claims := '{}'::jsonb;
  end;
  return jsonb_strip_nulls(jsonb_build_object(
    'session_user', session_user,
    'current_user', current_user,
    'jwt_role', claims ->> 'role',
    'jwt_sub', claims ->> 'sub',
    'application_name', nullif(current_setting('application_name', true), ''),
    'client_addr', inet_client_addr()::text,
    'transaction_id', txid_current()::text
  ));
end;
$$;

create or replace function public.certification_audit_append(
  p_schema_name text,
  p_table_name text,
  p_operation text,
  p_record_key text,
  p_changed_fields text[],
  p_actor jsonb,
  p_old_values jsonb,
  p_new_values jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  event_time timestamptz := clock_timestamp();
  prior_sequence bigint;
  prior_hash text;
  next_sequence bigint;
  payload text;
  next_hash text;
  next_event_id uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(71420260822);
  select last_sequence, last_hash into prior_sequence, prior_hash
  from public.certification_audit_chain_state
  where singleton = true
  for update;
  if prior_hash is null then
    raise exception 'certification audit chain state is unavailable';
  end if;
  next_sequence := prior_sequence + 1;
  payload := jsonb_build_object(
    'sequence_no', next_sequence,
    'event_id', next_event_id,
    'occurred_at', to_char(event_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'schema_name', p_schema_name,
    'table_name', p_table_name,
    'operation', p_operation,
    'record_key', p_record_key,
    'changed_fields', coalesce(p_changed_fields, '{}'::text[]),
    'actor', coalesce(p_actor, '{}'::jsonb),
    'old_values', p_old_values,
    'new_values', p_new_values
  )::text;
  next_hash := encode(digest(convert_to(prior_hash || payload, 'UTF8'), 'sha256'), 'hex');

  insert into public.certification_audit_events (
    sequence_no, event_id, occurred_at, schema_name, table_name, operation,
    record_key, changed_fields, actor, old_values, new_values,
    chain_payload, previous_hash, event_hash
  ) values (
    next_sequence, next_event_id, event_time, p_schema_name, p_table_name, p_operation,
    p_record_key, coalesce(p_changed_fields, '{}'::text[]), coalesce(p_actor, '{}'::jsonb),
    p_old_values, p_new_values, payload, prior_hash, next_hash
  );
  insert into public.certification_audit_deliveries (event_id, sequence_no)
  values (next_event_id, next_sequence);
  update public.certification_audit_chain_state
  set last_sequence = next_sequence, last_hash = next_hash, updated_at = event_time
  where singleton = true;
  return next_event_id;
end;
$$;

revoke all on function public.certification_audit_append(text,text,text,text,text[],jsonb,jsonb,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.capture_certification_critical_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  relation_name text := format('%I.%I', tg_table_schema, tg_table_name);
  row_value jsonb := coalesce(new_row, old_row);
  record_key text;
begin
  record_key := coalesce(
    row_value ->> 'user_id', row_value ->> 'id', row_value ->> 'bridge_customer_id',
    row_value ->> 'bridge_wallet_id', row_value ->> 'bridge_virtual_account_id',
    row_value ->> 'bridge_external_account_id', row_value ->> 'provider_transaction_id'
  );
  perform public.certification_audit_append(
    tg_table_schema, tg_table_name, tg_op, record_key,
    public.certification_audit_changed_fields(old_row, new_row),
    public.certification_audit_actor(),
    public.certification_audit_safe_values(relation_name, old_row),
    public.certification_audit_safe_values(relation_name, new_row)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.capture_certification_critical_mutation()
  from public, anon, authenticated, service_role;

do $$
declare
  relation_name text;
  trigger_name text;
begin
  foreach relation_name in array array[
    'auth.users',
    'public.user_profiles',
    'public.business_profiles',
    'public.account_origin_provenance',
    'public.operator_bridge_accounts',
    'public.bridge_wallets',
    'public.bridge_virtual_accounts',
    'public.bridge_external_accounts',
    'public.wallets',
    'public.transactions'
  ] loop
    if to_regclass(relation_name) is not null then
      trigger_name := 'certification_audit_' || replace(relation_name, '.', '_');
      execute format('drop trigger if exists %I on %s', trigger_name, relation_name);
      execute format(
        'create trigger %I after insert or update or delete on %s for each row execute function public.capture_certification_critical_mutation()',
        trigger_name, relation_name
      );
      execute format('drop trigger if exists %I on %s', trigger_name || '_truncate', relation_name);
      execute format(
        'create trigger %I after truncate on %s for each statement execute function public.capture_certification_critical_mutation()',
        trigger_name || '_truncate', relation_name
      );
    end if;
  end loop;
end $$;

create or replace function public.append_certification_audit_marker(
  p_capture_id text,
  p_account_id uuid,
  p_marker_kind text
)
returns table(sequence_no bigint, event_hash text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  marker_event uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_capture_id is null or length(trim(p_capture_id)) < 12 then
    raise exception 'capture id is required';
  end if;
  if p_marker_kind not in ('START','END','HEARTBEAT') then
    raise exception 'invalid marker kind';
  end if;
  marker_event := public.certification_audit_append(
    'certification', 'control', 'MARKER', p_account_id::text,
    array[p_marker_kind], public.certification_audit_actor(), null,
    jsonb_build_object('capture_id', p_capture_id, 'account_id', p_account_id, 'marker_kind', p_marker_kind)
  );
  return query
  select e.sequence_no, e.event_hash
  from public.certification_audit_events e where e.event_id = marker_event;
end;
$$;

revoke all on function public.append_certification_audit_marker(text,uuid,text) from public, anon, authenticated;
grant execute on function public.append_certification_audit_marker(text,uuid,text) to service_role;

create or replace function public.claim_certification_audit_deliveries(p_limit integer default 50)
returns table(
  event_id uuid,
  sequence_no bigint,
  occurred_at timestamptz,
  schema_name text,
  table_name text,
  operation text,
  record_key text,
  changed_fields text[],
  actor jsonb,
  old_values jsonb,
  new_values jsonb,
  chain_payload text,
  previous_hash text,
  event_hash text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with claimed as (
    select d.event_id
    from public.certification_audit_deliveries d
    where d.status in ('pending','failed') and d.next_attempt_at <= now()
    order by d.sequence_no
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ), updated as (
    update public.certification_audit_deliveries d
    set status = 'processing', attempt_count = d.attempt_count + 1, updated_at = now()
    from claimed c
    where d.event_id = c.event_id
    returning d.event_id
  )
  select e.event_id, e.sequence_no, e.occurred_at, e.schema_name, e.table_name,
         e.operation, e.record_key, e.changed_fields, e.actor, e.old_values,
         e.new_values, e.chain_payload, e.previous_hash, e.event_hash
  from public.certification_audit_events e
  join updated u on u.event_id = e.event_id
  order by e.sequence_no;
end;
$$;

revoke all on function public.claim_certification_audit_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_certification_audit_deliveries(integer) to service_role;

create or replace function public.record_certification_audit_receipt(
  p_event_id uuid,
  p_receipt_id text,
  p_sink_key_id text,
  p_signed_receipt text,
  p_stored_at timestamptz,
  p_retention_until timestamptz,
  p_object_lock_mode text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_object_lock_mode <> 'COMPLIANCE' or p_retention_until <= p_stored_at then
    raise exception 'invalid immutable sink receipt';
  end if;
  update public.certification_audit_deliveries
  set status = 'delivered', receipt_id = p_receipt_id, sink_key_id = p_sink_key_id,
      signed_receipt = p_signed_receipt, stored_at = p_stored_at,
      retention_until = p_retention_until, object_lock_mode = p_object_lock_mode,
      delivered_at = now(), last_error = null, updated_at = now()
  where event_id = p_event_id
    and status = 'processing'
    and receipt_id is null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.record_certification_audit_receipt(uuid,text,text,text,timestamptz,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.record_certification_audit_receipt(uuid,text,text,text,timestamptz,timestamptz,text)
  to service_role;

create or replace function public.fail_certification_audit_delivery(p_event_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.certification_audit_deliveries
  set status = 'failed', last_error = left(coalesce(p_error, 'delivery failed'), 1000),
      next_attempt_at = now() + interval '5 minutes', updated_at = now()
  where event_id = p_event_id and status = 'processing';
end;
$$;

revoke all on function public.fail_certification_audit_delivery(uuid,text) from public, anon, authenticated;
grant execute on function public.fail_certification_audit_delivery(uuid,text) to service_role;

create or replace function public.reject_certification_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'certification audit ledger is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists certification_audit_events_immutable on public.certification_audit_events;
create trigger certification_audit_events_immutable
before update or delete on public.certification_audit_events
for each row execute function public.reject_certification_audit_mutation();

drop trigger if exists certification_audit_chain_state_no_delete on public.certification_audit_chain_state;
create trigger certification_audit_chain_state_no_delete
before delete on public.certification_audit_chain_state
for each row execute function public.reject_certification_audit_mutation();

comment on table public.certification_audit_events is
  'Sequenced hash-chained observation ledger; authoritative certification additionally requires independently signed append-only sink receipts.';
