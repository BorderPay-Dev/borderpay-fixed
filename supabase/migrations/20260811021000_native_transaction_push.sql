-- Native transaction push delivery for authenticated BorderPay devices.
-- In-app notifications remain the source of truth; push is a privacy-safe hint.

create table if not exists public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  device_id text not null,
  token text not null,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, platform, device_id)
);

create index if not exists push_device_tokens_user_active_idx
  on public.push_device_tokens(user_id, active, last_seen_at desc);
create index if not exists push_device_tokens_token_idx
  on public.push_device_tokens(token);

alter table public.push_device_tokens enable row level security;
drop policy if exists push_device_tokens_read_own on public.push_device_tokens;
create policy push_device_tokens_read_own on public.push_device_tokens
  for select to authenticated using (user_id = auth.uid());

create or replace function public.register_push_device(
  p_token text,
  p_platform text,
  p_device_id text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if length(trim(coalesce(p_token,''))) < 20 then raise exception 'invalid_push_token'; end if;
  if p_platform not in ('ios','android') then raise exception 'invalid_platform'; end if;
  if length(trim(coalesce(p_device_id,''))) < 8 then raise exception 'invalid_device_id'; end if;

  -- An FCM token belongs to one current account. Revoke stale ownership first
  -- so a shared device can never receive another user's transaction status.
  update public.push_device_tokens
     set active=false, updated_at=now()
   where token=p_token and user_id<>v_user and active=true;

  insert into public.push_device_tokens(user_id,platform,device_id,token,active,last_seen_at,updated_at)
  values(v_user,p_platform,p_device_id,trim(p_token),true,now(),now())
  on conflict(user_id,platform,device_id) do update
    set token=excluded.token,active=true,last_seen_at=now(),updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.unregister_push_device(p_device_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.push_device_tokens set active=false,updated_at=now()
   where user_id=auth.uid() and device_id=p_device_id;
end $$;

revoke all on function public.register_push_device(text,text,text) from public,anon;
grant execute on function public.register_push_device(text,text,text) to authenticated;
revoke all on function public.unregister_push_device(text) from public,anon;
grant execute on function public.unregister_push_device(text) to authenticated;

create table if not exists public.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','processing','delivered','no_devices','retry','failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id)
);
create index if not exists push_delivery_queue_drain_idx
  on public.push_delivery_queue(status,next_attempt_at,created_at);
alter table public.push_delivery_queue enable row level security;

create or replace function public.enqueue_transaction_push()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.type::text <> 'transaction' then return new; end if;
  insert into public.push_delivery_queue(notification_id,user_id,title,body,data)
  values(
    new.id,
    new.user_id,
    left(new.title,120),
    'Open BorderPay to view transaction details.',
    jsonb_build_object('route','transactions','notification_id',new.id::text,'kind','transaction')
  ) on conflict(notification_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_enqueue_transaction_push on public.notifications;
create trigger trg_enqueue_transaction_push
after insert on public.notifications for each row execute function public.enqueue_transaction_push();

create or replace function public.claim_push_deliveries(p_limit integer default 50)
returns setof public.push_delivery_queue
language plpgsql security definer set search_path=public as $$
begin
  return query
  with claimed as (
    select q.id from public.push_delivery_queue q
    where q.status in ('pending','retry') and q.next_attempt_at<=now()
    order by q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.push_delivery_queue q
     set status='processing',attempt_count=q.attempt_count+1,updated_at=now()
    from claimed where q.id=claimed.id
  returning q.*;
end $$;
revoke all on function public.claim_push_deliveries(integer) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(integer) to service_role;

do $$ begin
  if exists(select 1 from cron.job where jobname='transaction-push-drain') then
    perform cron.unschedule('transaction-push-drain');
  end if;
end $$;
select cron.schedule(
  'transaction-push-drain','* * * * *',
  $job$select net.http_post(
    url := 'https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/push-delivery-worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.app_config_get('worker_auth_token')),
    body := '{"limit":50}'::jsonb,
    timeout_milliseconds := 55000
  );$job$
);
