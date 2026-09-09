-- Operator/partner Bridge account exclusions.
--
-- Historical provenance: this is the exact migration recovered from the
-- 2026-06-24 local implementation record. It restores a manually-applied
-- production contract to the replayable migration chain.

create table if not exists public.operator_bridge_accounts (
  bridge_customer_id text primary key,
  label text not null,
  purpose text not null default 'operator_account',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operator_bridge_accounts_active_idx
  on public.operator_bridge_accounts (active)
  where active = true;

alter table public.operator_bridge_accounts enable row level security;

drop policy if exists operator_bridge_accounts_admin_read on public.operator_bridge_accounts;
create policy operator_bridge_accounts_admin_read
  on public.operator_bridge_accounts
  for select
  to authenticated
  using (public.is_borderpay_admin());

drop policy if exists operator_bridge_accounts_service_role on public.operator_bridge_accounts;
create policy operator_bridge_accounts_service_role
  on public.operator_bridge_accounts
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.is_operator_bridge_customer(p_bridge_customer_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.operator_bridge_accounts o
    where o.bridge_customer_id = p_bridge_customer_id
      and o.active = true
  );
$$;

-- This is platform configuration, not customer data. The fixed operator ID
-- is required so a disaster-recovery rebuild preserves the production
-- lifecycle exclusion rather than treating the operator as a customer.
insert into public.operator_bridge_accounts (
  bridge_customer_id,
  label,
  purpose,
  metadata
) values (
  '89a7491e-8592-4d23-bb4f-3870f2ddd73b',
  'BorderPay Africa, Inc.',
  'operator_partner_admin',
  jsonb_build_object(
    'exclude_from_customer_lifecycle', true,
    'exclude_from_parity_checks', true,
    'notes', 'Imported Bridge operator account used for treasury/fee collection/admin monitoring.'
  )
)
on conflict (bridge_customer_id) do update
set
  label = excluded.label,
  purpose = excluded.purpose,
  metadata = excluded.metadata,
  active = true,
  updated_at = now();
