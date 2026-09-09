-- Persist affiliate-program membership independently from referrals/earnings.
-- A user must appear in the admin panel immediately after completing the
-- BorderPay SSO exchange, even when they have no referral activity yet.

create table if not exists public.affiliate_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  source text not null default 'borderpay_sso',
  joined_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_accounts_status_joined_idx
  on public.affiliate_accounts (status, joined_at desc);

alter table public.affiliate_accounts enable row level security;

drop policy if exists affiliate_accounts_self_select on public.affiliate_accounts;
create policy affiliate_accounts_self_select
  on public.affiliate_accounts
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists affiliate_accounts_admin_select on public.affiliate_accounts;
create policy affiliate_accounts_admin_select
  on public.affiliate_accounts
  for select
  to authenticated
  using (public.is_borderpay_admin());

drop policy if exists affiliate_accounts_service_role_all on public.affiliate_accounts;
create policy affiliate_accounts_service_role_all
  on public.affiliate_accounts
  to service_role
  using (true)
  with check (true);

revoke all on table public.affiliate_accounts from anon;
grant select on table public.affiliate_accounts to authenticated;
grant all on table public.affiliate_accounts to service_role;

-- Complete the SSO exchange exactly once and record program membership in the
-- same transaction. Existing suspended/closed memberships are never silently
-- reactivated by signing in again.
create or replace function public.consume_affiliate_sso_and_join(
  p_jti uuid,
  p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_consumed boolean := false;
begin
  update public.affiliate_sso_nonces
     set consumed_at = now()
   where jti = p_jti
     and user_id = p_user_id
     and consumed_at is null
     and expires_at > now();

  v_consumed := found;
  if not v_consumed then
    return false;
  end if;

  insert into public.affiliate_accounts (
    user_id,
    status,
    source,
    joined_at,
    last_accessed_at,
    created_at,
    updated_at
  ) values (
    p_user_id,
    'active',
    'borderpay_sso',
    now(),
    now(),
    now(),
    now()
  )
  on conflict (user_id) do update
    set last_accessed_at = excluded.last_accessed_at,
        updated_at = excluded.updated_at;

  return true;
end;
$$;

revoke all on function public.consume_affiliate_sso_and_join(uuid, uuid) from public;
revoke all on function public.consume_affiliate_sso_and_join(uuid, uuid) from anon;
revoke all on function public.consume_affiliate_sso_and_join(uuid, uuid) from authenticated;
grant execute on function public.consume_affiliate_sso_and_join(uuid, uuid) to service_role;

-- Preserve affiliates who requested a valid linked-account SSO session before
-- durable membership existed. This is intentionally based only on server-
-- issued nonces, never on public referral input.
insert into public.affiliate_accounts (
  user_id,
  status,
  source,
  joined_at,
  last_accessed_at,
  created_at,
  updated_at
)
select distinct on (n.user_id)
  n.user_id,
  'active',
  'legacy_sso_issued',
  n.issued_at,
  n.issued_at,
  n.issued_at,
  n.issued_at
from public.affiliate_sso_nonces n
order by n.user_id, n.issued_at asc
on conflict (user_id) do nothing;
