-- Backfill missing signup abuse-protection primitive in production.
--
-- auth-signup calls public.enforce_signup_abuse_protection before creating
-- auth.users. If the RPC is absent from a deployed database, every new signup
-- fails before persistence. Keep this migration narrowly scoped and idempotent.

set search_path = public, extensions, pg_temp;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.signup_abuse_events (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists signup_abuse_events_created_idx
  on public.signup_abuse_events (created_at desc);
create index if not exists signup_abuse_events_email_idx
  on public.signup_abuse_events (email_hash, created_at desc);
create index if not exists signup_abuse_events_ip_idx
  on public.signup_abuse_events (ip_address, created_at desc)
  where ip_address is not null;

alter table public.signup_abuse_events enable row level security;
drop policy if exists signup_abuse_events_service_role on public.signup_abuse_events;
create policy signup_abuse_events_service_role
  on public.signup_abuse_events for all to service_role
  using (true) with check (true);

create or replace function public.enforce_signup_abuse_protection(
  p_email text,
  p_ip inet default null,
  p_user_agent text default null,
  p_email_limit_per_hour int default 5,
  p_ip_limit_per_hour int default 25,
  p_cooldown_seconds int default 20
)
returns table (
  allowed boolean,
  code text,
  retry_after_seconds int
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_email text;
  v_hash text;
  v_email_count int := 0;
  v_ip_count int := 0;
  v_last_at timestamptz;
  v_retry int := 0;
begin
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    return query select false, 'email_required'::text, 0;
    return;
  end if;

  v_hash := encode(extensions.digest(v_email, 'sha256'), 'hex');

  select count(*)::int into v_email_count
    from public.signup_abuse_events
   where email_hash = v_hash
     and created_at > v_now - interval '1 hour';

  if p_ip is not null then
    select count(*)::int into v_ip_count
      from public.signup_abuse_events
     where ip_address = p_ip
       and created_at > v_now - interval '1 hour';
  end if;

  select max(created_at) into v_last_at
    from public.signup_abuse_events
   where email_hash = v_hash
      or (p_ip is not null and ip_address = p_ip);

  if v_last_at is not null and v_last_at > v_now - make_interval(secs => greatest(1, p_cooldown_seconds)) then
    v_retry := greatest(1, ceil(extract(epoch from ((v_last_at + make_interval(secs => greatest(1, p_cooldown_seconds))) - v_now)))::int);
    return query select false, 'cooldown'::text, v_retry;
    return;
  end if;

  if v_email_count >= greatest(1, p_email_limit_per_hour) then
    return query select false, 'email_rate_limited'::text, 3600;
    return;
  end if;

  if p_ip is not null and v_ip_count >= greatest(1, p_ip_limit_per_hour) then
    return query select false, 'ip_rate_limited'::text, 3600;
    return;
  end if;

  insert into public.signup_abuse_events (email_hash, ip_address, user_agent)
  values (v_hash, p_ip, left(coalesce(p_user_agent, ''), 512));

  return query select true, 'ok'::text, 0;
end;
$$;

revoke all on function public.enforce_signup_abuse_protection(text, inet, text, int, int, int) from public;
grant execute on function public.enforce_signup_abuse_protection(text, inet, text, int, int, int) to service_role;
