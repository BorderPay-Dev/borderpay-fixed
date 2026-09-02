-- BorderPay Partners is a separate control plane from customer KYC/KYB.
-- Applicants cannot become API tenants, set pricing, or approve themselves.

begin;

create table if not exists public.partner_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete restrict,
  legal_name text,
  trading_name text,
  primary_email text not null,
  website text,
  country_of_incorporation text,
  registration_number text,
  tax_identifier text,
  status text not null default 'draft'
    check (status in ('draft','submitted','under_review','more_information','approved','rejected','suspended')),
  approved_tenant_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_organizations_primary_email_format
    check (primary_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint partner_organizations_country_format
    check (country_of_incorporation is null or country_of_incorporation ~ '^[A-Z]{2}$')
);

create table if not exists public.partner_members (
  organization_id uuid not null references public.partner_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','admin','compliance','developer','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft'
    check (status in ('draft','submitted','under_review','more_information','approved','rejected','withdrawn')),
  requested_products text[] not null default '{}'::text[],
  entity_details jsonb not null default '{}'::jsonb,
  operating_details jsonb not null default '{}'::jsonb,
  compliance_details jsonb not null default '{}'::jsonb,
  technical_details jsonb not null default '{}'::jsonb,
  declarations jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  decided_at timestamptz,
  decision_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_applications_products_allowed
    check (requested_products <@ array['api','white_label']::text[]),
  constraint partner_applications_products_nonempty_on_submit
    check (status = 'draft' or cardinality(requested_products) > 0)
);

create unique index if not exists partner_applications_one_open_idx
  on public.partner_applications (organization_id)
  where status in ('draft','submitted','under_review','more_information');

create index if not exists partner_applications_status_created_idx
  on public.partner_applications (status, created_at desc);

create table if not exists public.partner_controlling_people (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  person_type text not null check (person_type in ('ubo','director','controller')),
  full_name text not null,
  date_of_birth date not null,
  nationality text not null check (nationality ~ '^[A-Z]{2}$'),
  country_of_residence text not null check (country_of_residence ~ '^[A-Z]{2}$'),
  residential_address text not null,
  ownership_percent numeric(5,2),
  is_politically_exposed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_controlling_people_ownership_range
    check (ownership_percent is null or (ownership_percent >= 0 and ownership_percent <= 100)),
  constraint partner_ubo_ownership_required
    check (person_type <> 'ubo' or ownership_percent is not null)
);

create index if not exists partner_controlling_people_application_idx
  on public.partner_controlling_people (application_id);

create table if not exists public.partner_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  document_type text not null check (document_type in (
    'certificate_of_incorporation','articles_of_association','register_of_directors',
    'register_of_shareholders','ubo_identity','ubo_address','director_identity',
    'operating_licence','aml_policy','privacy_policy','security_policy',
    'financial_statement','bank_statement','nda','other'
  )),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists partner_application_documents_application_idx
  on public.partner_application_documents (application_id, created_at desc);

create table if not exists public.partner_application_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('under_review','more_information','approved','rejected','suspended')),
  notes text not null,
  created_at timestamptz not null default now()
);

create index if not exists partner_application_reviews_application_idx
  on public.partner_application_reviews (application_id, created_at desc);

create table if not exists public.partner_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete restrict,
  provider text not null check (provider in ('bridge','yellow_card')),
  product text not null check (product in ('virtual_account','crypto_payout','fiat_payout','african_rails_send','african_rails_receive')),
  source_currency text,
  destination_currency text,
  fee_type text not null check (fee_type in ('percent','fixed','provider_plus_percent','provider_plus_fixed')),
  fee_percent numeric(8,5),
  fixed_amount numeric(20,8),
  fixed_currency text,
  effective_from timestamptz not null,
  effective_until timestamptz,
  is_active boolean not null default true,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_reference text not null,
  created_at timestamptz not null default now(),
  constraint partner_pricing_rule_value_required check (
    (fee_type in ('percent','provider_plus_percent') and fee_percent is not null and fee_percent >= 0)
    or
    (fee_type in ('fixed','provider_plus_fixed') and fixed_amount is not null and fixed_amount >= 0 and fixed_currency is not null)
  ),
  constraint partner_pricing_rule_window check (effective_until is null or effective_until > effective_from)
);

create index if not exists partner_pricing_rules_lookup_idx
  on public.partner_pricing_rules (organization_id, provider, product, is_active, effective_from desc);

create table if not exists public.partner_portal_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.partner_organizations(id) on delete set null,
  application_id uuid references public.partner_applications(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists partner_portal_audit_org_created_idx
  on public.partner_portal_audit_log (organization_id, created_at desc);

create table if not exists public.partner_access_invite_requests (
  id bigint generated always as identity primary key,
  email text not null,
  requester_ip_hash text,
  requested_at timestamptz not null default now()
);

create index if not exists partner_access_invite_email_time_idx
  on public.partner_access_invite_requests (email, requested_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-due-diligence', 'partner-due-diligence', false, 10485760,
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.partner_organizations enable row level security;
alter table public.partner_members enable row level security;
alter table public.partner_applications enable row level security;
alter table public.partner_controlling_people enable row level security;
alter table public.partner_application_documents enable row level security;
alter table public.partner_application_reviews enable row level security;
alter table public.partner_pricing_rules enable row level security;
alter table public.partner_portal_audit_log enable row level security;
alter table public.partner_access_invite_requests enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'partner_organizations','partner_members','partner_applications',
    'partner_controlling_people','partner_application_documents',
    'partner_application_reviews','partner_pricing_rules',
    'partner_portal_audit_log','partner_access_invite_requests'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

-- Existing application storage policies remain authoritative. Partner files
-- are accessed only through short-lived signed URLs issued by the Edge API.

comment on table public.partner_organizations is
  'Partner control-plane identity; separate from BorderPay customer profiles and Bridge KYB.';
comment on table public.partner_pricing_rules is
  'Operator-approved custom partner pricing. Never inherits BorderPay retail customer pricing.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'partner_organizations_approved_tenant_fk'
       and conrelid = 'public.partner_organizations'::regclass
  ) then
    alter table public.partner_organizations
      add constraint partner_organizations_approved_tenant_fk
      foreign key (approved_tenant_id) references public.api_tenants(id) on delete set null;
  end if;
end $$;

grant usage, select on all sequences in schema public to service_role;

commit;
