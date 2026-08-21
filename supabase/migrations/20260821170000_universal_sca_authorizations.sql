-- Universal strong-customer-authentication authorizations.
--
-- A normal Supabase session is not sufficient for the protected operations.
-- The sca-authorize Edge Function records two independently verified factors
-- (server-verified PIN + server-verified TOTP) against an exact operation
-- payload. Protected Edge Functions consume that authorization atomically.

create table if not exists public.sca_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in (
    'wallet_access', 'payment', 'beneficiary_change', 'security_change'
  )),
  resource text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  verified_factors text[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint sca_two_independent_factors check (
    verified_factors @> array['pin', 'totp']::text[]
  ),
  constraint sca_short_lived check (
    expires_at > created_at and expires_at <= created_at + interval '5 minutes'
  )
);

alter table public.user_security
  add column if not exists last_totp_counter bigint;

create or replace function public.consume_totp_counter(
  p_user_id uuid,
  p_counter bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated uuid;
begin
  update public.user_security
     set last_totp_counter = p_counter,
         updated_at = now()
   where user_id = p_user_id
     and (last_totp_counter is null or last_totp_counter < p_counter)
  returning user_id into v_updated;
  return v_updated is not null;
end;
$$;
revoke all on function public.consume_totp_counter(uuid, bigint) from public, anon, authenticated;
grant execute on function public.consume_totp_counter(uuid, bigint) to service_role;

create index if not exists sca_authorizations_user_expiry_idx
  on public.sca_authorizations (user_id, expires_at desc);

alter table public.sca_authorizations enable row level security;
revoke all on public.sca_authorizations from anon, authenticated;

create table if not exists public.sca_audit_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  authorization_id uuid references public.sca_authorizations(id) on delete set null,
  event_type text not null check (event_type in (
    'authorization_succeeded', 'authorization_failed', 'authorization_consumed',
    'authorization_rejected'
  )),
  operation text,
  resource text,
  payload_hash text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists sca_audit_events_user_created_idx
  on public.sca_audit_events (user_id, created_at desc);

alter table public.sca_audit_events enable row level security;
revoke all on public.sca_audit_events from anon, authenticated;

create or replace function public.consume_sca_authorization(
  p_authorization_id uuid,
  p_user_id uuid,
  p_operation text,
  p_resource text,
  p_payload_hash text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consumed uuid;
begin
  update public.sca_authorizations
     set consumed_at = now()
   where id = p_authorization_id
     and user_id = p_user_id
     and operation = p_operation
     and resource = p_resource
     and payload_hash = p_payload_hash
     and consumed_at is null
     and expires_at > now()
     and verified_factors @> array['pin', 'totp']::text[]
  returning id into v_consumed;

  if v_consumed is not null then
    insert into public.sca_audit_events (
      user_id, authorization_id, event_type, operation, resource, payload_hash
    ) values (
      p_user_id, v_consumed, 'authorization_consumed', p_operation, p_resource, p_payload_hash
    );
    return true;
  end if;

  insert into public.sca_audit_events (
    user_id, authorization_id, event_type, operation, resource, payload_hash, reason
  ) values (
    p_user_id, p_authorization_id, 'authorization_rejected', p_operation,
    p_resource, p_payload_hash, 'missing_expired_consumed_or_mismatched'
  );
  return false;
end;
$$;

revoke all on function public.consume_sca_authorization(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_sca_authorization(uuid, uuid, text, text, text)
  to service_role;

create table if not exists public.sca_wallet_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  authorization_id uuid not null references public.sca_authorizations(id) on delete cascade,
  check (expires_at > granted_at and expires_at <= granted_at + interval '5 minutes')
);
alter table public.sca_wallet_access_grants enable row level security;
revoke all on public.sca_wallet_access_grants from anon, authenticated;

create or replace function public.has_fresh_sca_wallet_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.sca_wallet_access_grants
     where user_id = p_user_id and expires_at > now()
  );
$$;
revoke all on function public.has_fresh_sca_wallet_access(uuid) from public, anon;
grant execute on function public.has_fresh_sca_wallet_access(uuid) to authenticated, service_role;
