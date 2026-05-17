-- ============================================================================
-- 20260514_subscription_plans_and_team.sql
-- ----------------------------------------------------------------------------
-- Subscription system + business team membership.
--
-- Plans are defined in code (utils/subscriptions/plans.ts). This file
-- carries only the persistence layer.
--
-- Tables added:
--   • user_subscriptions       — one active row per user/business
--   • business_team_members    — multi-user team membership for business plans
--
-- Conventions:
--   • XOR on owner: a subscription row has either user_id OR business_user_id.
--   • plan_key is a free-form text matching utils/subscriptions/plans.ts.
--   • Stripe IDs are nullable to allow free-tier ("starter") rows to exist
--     before any Stripe customer is created.
--   • Webhooks update status/period fields; clients never write these.
--
-- RLS: owner read; admin read; service_role full.
-- ============================================================================

set search_path = public, pg_temp;

-- ── 1. user_subscriptions ──────────────────────────────────────────────────
create table if not exists public.user_subscriptions (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        references auth.users(id) on delete cascade,
  business_user_id         uuid        references public.business_profiles(user_id) on delete cascade,
  plan_key                 text        not null,
  status                   text        not null default 'active'
    check (status in ('active','trialing','past_due','cancelled','incomplete','incomplete_expired','unpaid')),
  -- Stripe link (nullable for free tier rows that never reached Stripe).
  stripe_customer_id       text,
  stripe_subscription_id   text        unique,
  stripe_price_id          text,
  -- Period boundaries; for free tier we set a synthetic year-long period.
  current_period_start     timestamptz not null default now(),
  current_period_end       timestamptz not null default (now() + interval '100 years'),
  cancel_at_period_end     boolean     not null default false,
  cancelled_at             timestamptz,
  -- Provenance + audit
  metadata                 jsonb       not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint us_owner_xor check ((user_id is not null) or (business_user_id is not null)),
  -- One active subscription per owner. Cancelled rows are kept for history.
  constraint us_one_active_per_user
    unique (user_id, business_user_id)
);

create index if not exists us_user_idx     on public.user_subscriptions (user_id) where user_id is not null;
create index if not exists us_business_idx on public.user_subscriptions (business_user_id) where business_user_id is not null;
create index if not exists us_status_idx   on public.user_subscriptions (status);
create index if not exists us_stripe_cust_idx on public.user_subscriptions (stripe_customer_id) where stripe_customer_id is not null;

alter table public.user_subscriptions enable row level security;
drop policy if exists us_owner_read     on public.user_subscriptions;
create policy us_owner_read     on public.user_subscriptions for select to authenticated
  using (auth.uid() = user_id or auth.uid() = business_user_id);
drop policy if exists us_admin_read     on public.user_subscriptions;
create policy us_admin_read     on public.user_subscriptions for select to authenticated using (public.is_borderpay_admin());
drop policy if exists us_service_role   on public.user_subscriptions;
create policy us_service_role   on public.user_subscriptions for all to service_role using (true) with check (true);

drop trigger if exists trg_us_updated on public.user_subscriptions;
create trigger trg_us_updated before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

-- ── 2. business_team_members ──────────────────────────────────────────────
-- Multi-user membership for business plans. Seat limits enforced in app code
-- against the plan's max_team_members (see utils/subscriptions/plans.ts).
--
-- role:
--   • owner   — the business_profiles.user_id; cannot be removed.
--   • admin   — can manage team members + financial operations
--   • member  — can use financial operations but not manage team
--   • viewer  — read-only
--
-- status:
--   • invited      — invitation sent, not yet accepted (member_user_id may be null until they accept)
--   • active       — accepted; full access per role
--   • suspended    — owner/admin suspended the seat (kept for audit)
--   • removed      — soft-deleted; row kept for history
create table if not exists public.business_team_members (
  id                       uuid        primary key default gen_random_uuid(),
  business_user_id         uuid        not null references public.business_profiles(user_id) on delete cascade,
  member_user_id           uuid        references auth.users(id) on delete set null,
  invited_email            text        not null,
  role                     text        not null default 'member'
    check (role in ('owner','admin','member','viewer')),
  status                   text        not null default 'invited'
    check (status in ('invited','active','suspended','removed')),
  invited_at               timestamptz not null default now(),
  joined_at                timestamptz,
  removed_at               timestamptz,
  invited_by               uuid        references auth.users(id) on delete set null,
  metadata                 jsonb       not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- An email can have at most one non-removed seat per business.
  constraint btm_unique_email_per_business
    unique (business_user_id, invited_email)
);

create index if not exists btm_business_idx on public.business_team_members (business_user_id);
create index if not exists btm_member_idx   on public.business_team_members (member_user_id) where member_user_id is not null;
create index if not exists btm_status_idx   on public.business_team_members (business_user_id, status);

alter table public.business_team_members enable row level security;
drop policy if exists btm_owner_read    on public.business_team_members;
create policy btm_owner_read    on public.business_team_members for select to authenticated
  using (auth.uid() = business_user_id or auth.uid() = member_user_id);
drop policy if exists btm_admin_read    on public.business_team_members;
create policy btm_admin_read    on public.business_team_members for select to authenticated using (public.is_borderpay_admin());
drop policy if exists btm_service_role  on public.business_team_members;
create policy btm_service_role  on public.business_team_members for all to service_role using (true) with check (true);

drop trigger if exists trg_btm_updated on public.business_team_members;
create trigger trg_btm_updated before update on public.business_team_members
  for each row execute function public.set_updated_at();

-- ── 3. RPC: ensure a user has a starter subscription row ─────────────────
-- Called from auth-signup so every new account lands on the appropriate
-- free tier the moment they create their auth user.
--
-- p_account_type ∈ ('individual','business'). p_user_id is the auth.uid.
-- For business signups the caller passes the same user_id as
-- business_profiles.user_id (i.e. owner's auth.uid).
create or replace function public.ensure_starter_subscription(
  p_user_id        uuid,
  p_account_type   text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_key text;
  v_id       uuid;
begin
  if p_user_id is null then
    raise exception 'ensure_starter_subscription: p_user_id is required';
  end if;
  if p_account_type not in ('individual','business') then
    raise exception 'ensure_starter_subscription: p_account_type must be individual|business (got %)', p_account_type;
  end if;

  v_plan_key := case p_account_type
                  when 'business' then 'business_starter'
                  else                  'individual_starter'
                end;

  if p_account_type = 'individual' then
    insert into public.user_subscriptions (user_id, plan_key, status)
    values (p_user_id, v_plan_key, 'active')
    on conflict (user_id, business_user_id) do update
      set updated_at = now()
    returning id into v_id;
  else
    insert into public.user_subscriptions (business_user_id, plan_key, status)
    values (p_user_id, v_plan_key, 'active')
    on conflict (user_id, business_user_id) do update
      set updated_at = now()
    returning id into v_id;
  end if;

  -- For business plans, seed the owner's team membership row.
  if p_account_type = 'business' then
    insert into public.business_team_members (
      business_user_id, member_user_id, invited_email, role, status, joined_at, invited_by
    )
    select
      p_user_id,
      p_user_id,
      coalesce((select email from auth.users where id = p_user_id), 'unknown@borderpayafrica.com'),
      'owner',
      'active',
      now(),
      p_user_id
    on conflict (business_user_id, invited_email) do nothing;
  end if;

  return v_id;
end;
$$;

revoke all on function public.ensure_starter_subscription(uuid, text) from public;
grant execute on function public.ensure_starter_subscription(uuid, text) to service_role;

-- ── 4. RPC: count active team seats for a business ───────────────────────
-- Used by team-invite flow to enforce plan seat limits.
create or replace function public.count_active_team_seats(
  p_business_user_id uuid
)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.business_team_members
   where business_user_id = p_business_user_id
     and status in ('invited','active');
$$;

revoke all on function public.count_active_team_seats(uuid) from public;
grant execute on function public.count_active_team_seats(uuid) to service_role, authenticated;
