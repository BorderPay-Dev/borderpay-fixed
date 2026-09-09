-- Durable, tenant-scoped outbound webhook delivery for API partners.
-- Legacy endpoints contain only a one-way secret hash and therefore remain
-- delivery-disabled until an authorized secret rotation stores ciphertext.

alter table public.api_webhook_endpoints
  add column if not exists signing_secret_ciphertext text,
  add column if not exists signing_secret_nonce text,
  add column if not exists signing_secret_version integer not null default 1,
  add column if not exists delivery_enabled boolean not null default false,
  add column if not exists event_types text[] not null default array[]::text[];

alter table public.api_webhook_endpoints
  add constraint api_webhook_endpoints_delivery_secret_check check (
    not delivery_enabled or (
      signing_secret_ciphertext is not null and btrim(signing_secret_ciphertext) <> '' and
      signing_secret_nonce is not null and btrim(signing_secret_nonce) <> ''
    )
  ),
  add constraint api_webhook_endpoints_https_check check (
    not delivery_enabled or endpoint_url ~* '^https://'
  );

create table public.api_webhook_events (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.api_tenants(id) on delete restrict,
  tenant_end_user_id       uuid,
  resource_id              uuid references public.api_tenant_provider_resources(id) on delete set null,
  event_type               text not null check (
    event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  idempotency_key          text not null check (btrim(idempotency_key) <> ''),
  payload                  jsonb not null check (jsonb_typeof(payload) = 'object'),
  occurred_at              timestamptz not null,
  created_at               timestamptz not null default now(),
  constraint api_webhook_events_end_user_tenant_fk
    foreign key (tenant_end_user_id, tenant_id)
    references public.api_tenant_end_users(id, tenant_id) on delete restrict,
  constraint api_webhook_events_tenant_idempotency_unique
    unique (tenant_id, idempotency_key)
);

create index api_webhook_events_tenant_created_idx
  on public.api_webhook_events (tenant_id, created_at desc);

create table public.api_webhook_deliveries (
  id                       uuid primary key default gen_random_uuid(),
  event_id                 uuid not null references public.api_webhook_events(id) on delete cascade,
  endpoint_id              uuid not null references public.api_webhook_endpoints(id) on delete cascade,
  status                   text not null default 'pending' check (
    status in ('pending', 'processing', 'retrying', 'delivered', 'dead')
  ),
  attempt_count            integer not null default 0 check (attempt_count >= 0),
  next_attempt_at          timestamptz not null default now(),
  locked_by                text,
  locked_at                timestamptz,
  response_status          integer,
  last_error               text,
  delivered_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint api_webhook_deliveries_event_endpoint_unique
    unique (event_id, endpoint_id)
);

create index api_webhook_deliveries_drain_idx
  on public.api_webhook_deliveries (status, next_attempt_at, created_at)
  where status in ('pending', 'retrying', 'processing');

alter table public.api_webhook_events enable row level security;
alter table public.api_webhook_deliveries enable row level security;

create policy api_webhook_events_service_role
  on public.api_webhook_events for all to service_role using (true) with check (true);
create policy api_webhook_events_admin_read
  on public.api_webhook_events for select to authenticated
  using (public.is_borderpay_admin());
create policy api_webhook_deliveries_service_role
  on public.api_webhook_deliveries for all to service_role using (true) with check (true);
create policy api_webhook_deliveries_admin_read
  on public.api_webhook_deliveries for select to authenticated
  using (public.is_borderpay_admin());

create trigger trg_api_webhook_deliveries_touch
  before update on public.api_webhook_deliveries
  for each row execute function public.touch_updated_at();

create or replace function public.api_webhook_enqueue_event(
  p_tenant_id uuid,
  p_tenant_end_user_id uuid,
  p_resource_id uuid,
  p_event_type text,
  p_idempotency_key text,
  p_payload jsonb,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if not exists (
    select 1 from public.api_tenants t
    where t.id = p_tenant_id and t.is_active = true
  ) then
    raise exception 'inactive or unknown API tenant' using errcode = '42501';
  end if;

  if p_tenant_end_user_id is not null and not exists (
    select 1 from public.api_tenant_end_users u
    where u.id = p_tenant_end_user_id and u.tenant_id = p_tenant_id
  ) then
    raise exception 'tenant end-user ownership mismatch' using errcode = '42501';
  end if;

  if p_resource_id is not null and not exists (
    select 1 from public.api_tenant_provider_resources r
    where r.id = p_resource_id and r.tenant_id = p_tenant_id
      and (p_tenant_end_user_id is null or r.tenant_end_user_id = p_tenant_end_user_id)
  ) then
    raise exception 'tenant resource ownership mismatch' using errcode = '42501';
  end if;

  insert into public.api_webhook_events (
    tenant_id, tenant_end_user_id, resource_id, event_type,
    idempotency_key, payload, occurred_at
  ) values (
    p_tenant_id, p_tenant_end_user_id, p_resource_id, lower(btrim(p_event_type)),
    btrim(p_idempotency_key), coalesce(p_payload, '{}'::jsonb),
    coalesce(p_occurred_at, now())
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.api_webhook_events e
    where e.tenant_id = p_tenant_id
      and e.idempotency_key = btrim(p_idempotency_key)
      and e.event_type = lower(btrim(p_event_type));
    if v_event_id is null then
      raise exception 'webhook idempotency key conflicts with another event'
        using errcode = '23505';
    end if;
  end if;

  insert into public.api_webhook_deliveries (event_id, endpoint_id)
  select v_event_id, ep.id
  from public.api_webhook_endpoints ep
  where ep.tenant_id = p_tenant_id
    and ep.is_active = true
    and ep.delivery_enabled = true
    and (cardinality(ep.event_types) = 0 or lower(btrim(p_event_type)) = any(ep.event_types))
  on conflict (event_id, endpoint_id) do nothing;

  return v_event_id;
end;
$$;

revoke all on function public.api_webhook_enqueue_event(
  uuid, uuid, uuid, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.api_webhook_enqueue_event(
  uuid, uuid, uuid, text, text, jsonb, timestamptz
) to service_role;

-- Project verified provider lifecycle events only after their canonical
-- handler marks the queue row completed. The enqueue shares the completion
-- transaction: an ownership/enqueue error prevents silent notification loss.
create or replace function public.api_webhook_enqueue_completed_provider_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object jsonb;
  v_event_type text := lower(btrim(new.event_type));
  v_resource_type text;
  v_provider_resource_id text;
  v_resource record;
  v_status text;
  v_amount text;
  v_currency text;
  v_payload jsonb;
begin
  if new.source <> 'bridge' or new.status <> 'completed'
     or old.status = 'completed' then
    return new;
  end if;

  v_object := case
    when jsonb_typeof(new.payload->'event_object') = 'object' then new.payload->'event_object'
    when jsonb_typeof(new.payload->'data') = 'object' then new.payload->'data'
    else new.payload
  end;

  if v_event_type like 'customer.%' or v_event_type like 'kyc_link.%'
     or v_event_type like 'kyb_link.%' then
    v_resource_type := 'customer';
    v_provider_resource_id := coalesce(
      nullif(v_object->>'customer_id', ''),
      nullif(v_object#>>'{customer,id}', ''),
      nullif(v_object->>'id', ''),
      nullif(new.payload->>'event_object_id', '')
    );
  elsif v_event_type like 'virtual_account.%' then
    v_resource_type := 'virtual_account';
    v_provider_resource_id := coalesce(nullif(v_object->>'virtual_account_id', ''), nullif(v_object->>'id', ''), nullif(new.payload->>'event_object_id', ''));
  elsif v_event_type like 'wallet.%' then
    v_resource_type := 'wallet';
    v_provider_resource_id := coalesce(nullif(v_object->>'wallet_id', ''), nullif(v_object->>'id', ''), nullif(new.payload->>'event_object_id', ''));
  elsif v_event_type like 'external_account.%' then
    v_resource_type := 'external_account';
    v_provider_resource_id := coalesce(nullif(v_object->>'external_account_id', ''), nullif(v_object->>'id', ''), nullif(new.payload->>'event_object_id', ''));
  elsif v_event_type like 'transfer.%' then
    v_resource_type := 'transfer';
    v_provider_resource_id := coalesce(nullif(v_object->>'transfer_id', ''), nullif(v_object->>'id', ''), nullif(new.payload->>'event_object_id', ''));
  else
    return new;
  end if;

  if v_provider_resource_id is null then return new; end if;
  select r.id, r.tenant_id, r.tenant_end_user_id into v_resource
  from public.api_tenant_provider_resources r
  where r.provider = 'bridge'
    and r.resource_type = v_resource_type
    and r.provider_resource_id = v_provider_resource_id;
  if not found then return new; end if;

  v_status := lower(coalesce(nullif(v_object->>'status', ''), nullif(v_object->>'state', ''), nullif(v_object->>'kyc_status', ''), nullif(new.payload->>'event_object_status', '')));
  v_amount := coalesce(nullif(v_object->>'amount', ''), nullif(v_object#>>'{source,amount}', ''));
  v_currency := upper(coalesce(nullif(v_object->>'currency', ''), nullif(v_object#>>'{source,currency}', '')));
  v_payload := jsonb_build_object(
    'resource', jsonb_build_object('id', v_provider_resource_id, 'type', v_resource_type)
  );
  if v_status is not null then v_payload := v_payload || jsonb_build_object('status', v_status); end if;
  if v_amount is not null then v_payload := v_payload || jsonb_build_object('amount', v_amount); end if;
  if v_currency is not null then v_payload := v_payload || jsonb_build_object('currency', v_currency); end if;

  perform public.api_webhook_enqueue_event(
    v_resource.tenant_id,
    v_resource.tenant_end_user_id,
    v_resource.id,
    v_event_type,
    'provider:' || new.event_id,
    v_payload,
    coalesce(new.completed_at, now())
  );
  return new;
end;
$$;

revoke all on function public.api_webhook_enqueue_completed_provider_event()
  from public, anon, authenticated;

create trigger trg_api_webhook_enqueue_completed_provider_event
  after update of status on public.pending_events
  for each row execute function public.api_webhook_enqueue_completed_provider_event();

create or replace function public.api_webhook_claim_deliveries(
  p_worker_id text,
  p_batch_size integer default 50,
  p_lease_seconds integer default 120
)
returns table (
  delivery_id uuid,
  attempt_count integer,
  event_id uuid,
  event_type text,
  event_payload jsonb,
  event_occurred_at timestamptz,
  endpoint_id uuid,
  endpoint_url text,
  signing_secret_ciphertext text,
  signing_secret_nonce text,
  signing_secret_version integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;

  update public.api_webhook_deliveries d
  set status = 'retrying', locked_by = null, locked_at = null,
      next_attempt_at = now(), last_error = 'stale delivery lease recovered'
  where d.status = 'processing'
    and d.locked_at < now() - make_interval(secs => greatest(30, p_lease_seconds));

  return query
  with candidates as (
    select d.id
    from public.api_webhook_deliveries d
    join public.api_webhook_endpoints ep on ep.id = d.endpoint_id
    where d.status in ('pending', 'retrying')
      and d.next_attempt_at <= now()
      and ep.is_active = true
      and ep.delivery_enabled = true
    order by d.created_at
    limit least(greatest(p_batch_size, 1), 100)
    for update of d skip locked
  ), claimed as (
    update public.api_webhook_deliveries d
    set status = 'processing', locked_by = p_worker_id, locked_at = now(),
        attempt_count = d.attempt_count + 1
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select c.id, c.attempt_count, e.id, e.event_type, e.payload, e.occurred_at,
         ep.id, ep.endpoint_url, ep.signing_secret_ciphertext,
         ep.signing_secret_nonce, ep.signing_secret_version
  from claimed c
  join public.api_webhook_events e on e.id = c.event_id
  join public.api_webhook_endpoints ep on ep.id = c.endpoint_id;
end;
$$;

revoke all on function public.api_webhook_claim_deliveries(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_webhook_claim_deliveries(text, integer, integer)
  to service_role;

create or replace function public.api_webhook_finish_delivery(
  p_delivery_id uuid,
  p_worker_id text,
  p_success boolean,
  p_response_status integer default null,
  p_error text default null,
  p_terminal boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  select d.attempt_count into v_attempts
  from public.api_webhook_deliveries d
  where d.id = p_delivery_id and d.status = 'processing'
    and d.locked_by = p_worker_id
  for update;
  if not found then return false; end if;

  if p_success then
    update public.api_webhook_deliveries
    set status = 'delivered', response_status = p_response_status,
        last_error = null, delivered_at = now(), locked_by = null, locked_at = null
    where id = p_delivery_id;
  else
    update public.api_webhook_deliveries
    set status = case when p_terminal or v_attempts >= 10 then 'dead' else 'retrying' end,
        response_status = p_response_status,
        last_error = left(coalesce(p_error, 'delivery failed'), 1000),
        next_attempt_at = case when p_terminal or v_attempts >= 10 then next_attempt_at
          else now() + make_interval(secs => least(86400, 30 * (2 ^ least(v_attempts, 11))::integer)) end,
        locked_by = null, locked_at = null
    where id = p_delivery_id;
  end if;
  return true;
end;
$$;

revoke all on function public.api_webhook_finish_delivery(
  uuid, text, boolean, integer, text, boolean
) from public, anon, authenticated;
grant execute on function public.api_webhook_finish_delivery(
  uuid, text, boolean, integer, text, boolean
) to service_role;

create or replace function public.invoke_api_webhook_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text := nullif(public.app_config_get('api_webhook_worker_url'), '');
  v_token text := nullif(public.app_config_get('api_webhook_worker_token'), '');
  v_request_id bigint;
begin
  if v_url is null or v_token is null then
    raise notice 'API webhook worker invocation skipped: runtime config missing';
    return null;
  end if;
  if v_url !~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/api-webhook-worker$' then
    raise exception 'API webhook worker URL is not an approved Supabase function URL';
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := '{"batch_size":50}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.invoke_api_webhook_worker() from public, anon, authenticated;
grant execute on function public.invoke_api_webhook_worker() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'api-partner-webhook-drain';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'api-partner-webhook-drain',
    '* * * * *',
    'select public.invoke_api_webhook_worker();'
  );
end $$;
