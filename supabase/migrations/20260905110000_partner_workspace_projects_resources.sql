-- Partner workspace: audited KYB source, projects, tenant-owned resource
-- records, safe presentation settings, and support intake.
begin;

alter table public.partner_organizations
  add column if not exists kyb_source text not null default 'manual',
  add column if not exists bridge_customer_id text,
  add column if not exists bridge_verified_at timestamptz,
  add column if not exists bridge_verified_by uuid references auth.users(id) on delete set null;
alter table public.partner_organizations drop constraint if exists partner_organizations_kyb_source_check;
alter table public.partner_organizations add constraint partner_organizations_kyb_source_check
  check (kyb_source in ('manual','bridge_verified'));
create unique index if not exists partner_organizations_bridge_customer_unique
  on public.partner_organizations (bridge_customer_id) where bridge_customer_id is not null;

alter table public.partner_application_documents
  drop constraint if exists partner_application_documents_document_type_check;
alter table public.partner_application_documents
  add constraint partner_application_documents_document_type_check check (document_type in (
    'certificate_of_incorporation','articles_of_association','register_of_directors',
    'register_of_shareholders','ownership_chart','proof_of_registered_address',
    'ubo_identity','ubo_address','director_identity','operating_licence','aml_policy',
    'sanctions_policy','privacy_policy','security_policy','incident_response_policy',
    'financial_statement','bank_statement','source_of_funds','nda','other'
  ));

create table if not exists public.partner_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete cascade,
  tenant_id uuid references public.api_tenants(id) on delete set null,
  name text not null,
  slug text not null,
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  status text not null default 'pending' check (status in ('pending','active','disabled','rejected')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
create index if not exists partner_projects_org_created_idx on public.partner_projects (organization_id, created_at desc);
create unique index if not exists partner_projects_tenant_unique on public.partner_projects (tenant_id) where tenant_id is not null;

create table if not exists public.api_tenant_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.api_tenants(id) on delete cascade,
  resource_type text not null check (resource_type in ('customer','wallet','virtual_account','transfer','payout')),
  provider_resource_id text not null,
  customer_provider_id text,
  state text,
  amount numeric(30,12),
  source_currency text,
  destination_currency text,
  display_name text,
  external_reference text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, resource_type, provider_resource_id)
);
create index if not exists api_tenant_resources_tenant_type_created_idx on public.api_tenant_resources (tenant_id, resource_type, created_at desc);
create index if not exists api_tenant_resources_provider_idx on public.api_tenant_resources (provider_resource_id);

create table if not exists public.partner_workspace_settings (
  organization_id uuid primary key references public.partner_organizations(id) on delete cascade,
  brand_name text,
  primary_color text,
  support_email text,
  billing_email text,
  payout_contact_email text,
  email_sender_name text,
  email_reply_to text,
  two_factor_required boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint partner_workspace_settings_primary_color check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$')
);

create table if not exists public.partner_support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete cascade,
  project_id uuid references public.partner_projects(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  category text not null check (category in ('integration','compliance','billing','payout','security','other')),
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_support_tickets_org_created_idx on public.partner_support_tickets (organization_id, created_at desc);

alter table public.partner_projects enable row level security;
alter table public.api_tenant_resources enable row level security;
alter table public.partner_workspace_settings enable row level security;
alter table public.partner_support_tickets enable row level security;
revoke all on table public.partner_projects from anon, authenticated;
revoke all on table public.api_tenant_resources from anon, authenticated;
revoke all on table public.partner_workspace_settings from anon, authenticated;
revoke all on table public.partner_support_tickets from anon, authenticated;
grant all on table public.partner_projects to service_role;
grant all on table public.api_tenant_resources to service_role;
grant all on table public.partner_workspace_settings to service_role;
grant all on table public.partner_support_tickets to service_role;

drop policy if exists partner_projects_service_role on public.partner_projects;
create policy partner_projects_service_role on public.partner_projects for all to service_role using (true) with check (true);
drop policy if exists api_tenant_resources_service_role on public.api_tenant_resources;
create policy api_tenant_resources_service_role on public.api_tenant_resources for all to service_role using (true) with check (true);
drop policy if exists partner_workspace_settings_service_role on public.partner_workspace_settings;
create policy partner_workspace_settings_service_role on public.partner_workspace_settings for all to service_role using (true) with check (true);
drop policy if exists partner_support_tickets_service_role on public.partner_support_tickets;
create policy partner_support_tickets_service_role on public.partner_support_tickets for all to service_role using (true) with check (true);

drop trigger if exists trg_partner_projects_touch on public.partner_projects;
create trigger trg_partner_projects_touch before update on public.partner_projects for each row execute function public.touch_updated_at();
drop trigger if exists trg_api_tenant_resources_touch on public.api_tenant_resources;
create trigger trg_api_tenant_resources_touch before update on public.api_tenant_resources for each row execute function public.touch_updated_at();
drop trigger if exists trg_partner_workspace_settings_touch on public.partner_workspace_settings;
create trigger trg_partner_workspace_settings_touch before update on public.partner_workspace_settings for each row execute function public.touch_updated_at();
drop trigger if exists trg_partner_support_tickets_touch on public.partner_support_tickets;
create trigger trg_partner_support_tickets_touch before update on public.partner_support_tickets for each row execute function public.touch_updated_at();

insert into public.partner_projects (organization_id, tenant_id, name, slug, environment, status, created_by)
select o.id, o.approved_tenant_id, coalesce(o.trading_name, o.legal_name, 'Primary project'),
       'primary', coalesce(t.default_mode, 'sandbox'),
       case when coalesce(t.is_active, false) then 'active' else 'pending' end,
       o.owner_user_id
from public.partner_organizations o
left join public.api_tenants t on t.id = o.approved_tenant_id
where o.approved_tenant_id is not null
on conflict (organization_id, slug) do nothing;

commit;
