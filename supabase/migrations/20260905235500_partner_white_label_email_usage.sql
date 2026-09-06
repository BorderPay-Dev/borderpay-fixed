-- Tenant-scoped ledger for BorderPay-delivered white-label email. Successful
-- sends are billable units; failed sends remain visible but are not billable.
create table if not exists public.partner_email_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.api_tenants(id) on delete restrict,
  email_log_id uuid not null references public.email_log(id) on delete restrict,
  template text not null,
  delivery_status text not null check (delivery_status in ('sent','failed')),
  provider text,
  units integer not null default 1 check (units = 1),
  billable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, email_log_id)
);

create index if not exists partner_email_usage_monthly_idx
  on public.partner_email_usage_events (tenant_id, created_at desc)
  where billable = true;

alter table public.partner_email_usage_events enable row level security;
revoke all on table public.partner_email_usage_events from anon, authenticated;
grant all on table public.partner_email_usage_events to service_role;

drop policy if exists partner_email_usage_service_role on public.partner_email_usage_events;
create policy partner_email_usage_service_role on public.partner_email_usage_events
  for all to service_role using (true) with check (true);

drop policy if exists partner_email_usage_admin_read on public.partner_email_usage_events;
create policy partner_email_usage_admin_read on public.partner_email_usage_events
  for select to authenticated using (public.is_borderpay_admin());
