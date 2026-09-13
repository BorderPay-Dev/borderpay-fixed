-- Authenticated, read-only application access for explicitly approved Bridge
-- operator accounts. This is deliberately separate from user_profiles and
-- customer lifecycle tables so treasury/operator data cannot become customer
-- funds or gain customer money-movement capabilities.

begin;

create table if not exists public.operator_bridge_app_access (
  auth_email text primary key,
  bridge_customer_id text not null references public.operator_bridge_accounts(bridge_customer_id) on delete restrict,
  access_mode text not null default 'read_only' check (access_mode = 'read_only'),
  can_transfer boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operator_bridge_app_access_email_normalized
    check (auth_email = lower(trim(auth_email)) and position('@' in auth_email) > 1)
);

create table if not exists public.operator_bridge_read_audit (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  auth_email text not null,
  bridge_customer_id text not null references public.operator_bridge_accounts(bridge_customer_id) on delete restrict,
  action text not null check (action in ('snapshot', 'transfer')),
  succeeded boolean not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operator_bridge_read_audit_created_idx
  on public.operator_bridge_read_audit (created_at desc);

create table if not exists public.operator_bridge_transfer_intents (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  auth_email text not null,
  bridge_customer_id text not null references public.operator_bridge_accounts(bridge_customer_id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'submitted', 'failed')),
  bridge_transfer_id text,
  bridge_state text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_email, idempotency_key)
);

alter table public.operator_bridge_app_access enable row level security;
alter table public.operator_bridge_read_audit enable row level security;
alter table public.operator_bridge_transfer_intents enable row level security;

revoke all on public.operator_bridge_app_access from public, anon, authenticated;
revoke all on public.operator_bridge_read_audit from public, anon, authenticated;
revoke all on public.operator_bridge_transfer_intents from public, anon, authenticated;
grant all on public.operator_bridge_app_access to service_role;
grant all on public.operator_bridge_read_audit to service_role;
grant all on public.operator_bridge_transfer_intents to service_role;

insert into public.operator_bridge_accounts (
  bridge_customer_id,
  label,
  purpose,
  active,
  metadata
) values (
  'de412f3c-53c3-4d4a-987e-09d17c9cd7e2',
  'BorderPay Africa, Inc.',
  'operator_master_treasury',
  true,
  jsonb_build_object(
    'exclude_from_customer_lifecycle', true,
    'exclude_from_parity_checks', true,
    'application_access', 'authenticated_operator_only'
  )
)
on conflict (bridge_customer_id) do update
set label = excluded.label,
    purpose = excluded.purpose,
    active = true,
    metadata = excluded.metadata,
    updated_at = now();

insert into public.operator_bridge_app_access (
  auth_email,
  bridge_customer_id,
  access_mode,
  can_transfer,
  active
) values (
  'founder@borderpayafrica.com',
  'de412f3c-53c3-4d4a-987e-09d17c9cd7e2',
  'read_only',
  true,
  true
)
on conflict (auth_email) do update
set bridge_customer_id = excluded.bridge_customer_id,
    access_mode = 'read_only',
    can_transfer = true,
    active = true,
    updated_at = now();

commit;
