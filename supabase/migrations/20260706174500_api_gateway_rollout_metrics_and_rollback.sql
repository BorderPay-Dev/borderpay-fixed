-- Step 2M: rollout telemetry and rollback primitives for API closed-beta operations.

create or replace function public.api_gateway_rollout_metrics(
  p_tenant_id uuid,
  p_window_minutes integer default 15
)
returns table (
  window_minutes integer,
  total_requests bigint,
  error_requests bigint,
  error_rate_pct numeric,
  rate_limited_requests bigint,
  provider_error_requests bigint,
  p95_latency_ms integer,
  avg_latency_ms integer
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select *
    from public.api_request_log
    where tenant_id = p_tenant_id
      and created_at >= now() - make_interval(mins => greatest(1, coalesce(p_window_minutes, 15)))
  ),
  agg as (
    select
      count(*)::bigint as total_requests,
      count(*) filter (where status_code >= 400)::bigint as error_requests,
      count(*) filter (where error_code = 'rate_limited')::bigint as rate_limited_requests,
      count(*) filter (where error_code in ('provider_error', 'provider_unavailable'))::bigint as provider_error_requests,
      percentile_cont(0.95) within group (order by coalesce(latency_ms, 0))::integer as p95_latency_ms,
      avg(coalesce(latency_ms, 0))::integer as avg_latency_ms
    from base
  )
  select
    greatest(1, coalesce(p_window_minutes, 15))::integer as window_minutes,
    coalesce(a.total_requests, 0)::bigint,
    coalesce(a.error_requests, 0)::bigint,
    case when coalesce(a.total_requests, 0) = 0 then 0::numeric
      else round((a.error_requests::numeric / a.total_requests::numeric) * 100.0, 2)
    end as error_rate_pct,
    coalesce(a.rate_limited_requests, 0)::bigint,
    coalesce(a.provider_error_requests, 0)::bigint,
    coalesce(a.p95_latency_ms, 0)::integer,
    coalesce(a.avg_latency_ms, 0)::integer
  from agg a;
$$;

create or replace function public.api_gateway_emergency_rollback(
  p_tenant_id uuid,
  p_revoke_active_keys boolean default true
)
returns table (
  tenant_id uuid,
  beta_access_enabled boolean,
  default_mode text,
  is_active boolean,
  revoked_keys integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked integer := 0;
begin
  update public.api_tenants
     set beta_access_enabled = false,
         default_mode = 'sandbox',
         updated_at = now()
   where id = p_tenant_id;

  if p_revoke_active_keys then
    update public.api_keys
       set is_active = false,
           revoked_at = now(),
           updated_at = now()
     where tenant_id = p_tenant_id
       and is_active = true
       and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;

  return query
  select
    t.id,
    t.beta_access_enabled,
    t.default_mode,
    t.is_active,
    v_revoked
  from public.api_tenants t
  where t.id = p_tenant_id
  limit 1;
end;
$$;
