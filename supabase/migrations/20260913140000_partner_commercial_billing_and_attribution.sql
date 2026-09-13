-- Partner commercial billing and transaction attribution.
-- This migration never moves money. It creates auditable receivable/payable
-- records and enforces one mutually-exclusive delivery model per partner.

begin;

alter table public.partner_organizations
  add column if not exists partner_model text,
  add column if not exists commercial_status text not null default 'pending';

alter table public.partner_organizations drop constraint if exists partner_organizations_partner_model_check;
alter table public.partner_organizations add constraint partner_organizations_partner_model_check
  check (partner_model is null or partner_model in ('api','white_label'));
alter table public.partner_organizations drop constraint if exists partner_organizations_commercial_status_check;
alter table public.partner_organizations add constraint partner_organizations_commercial_status_check
  check (commercial_status in ('pending','signed','active','past_due','suspended'));

create or replace function public.enforce_single_partner_product()
returns trigger language plpgsql set search_path = public as $$
begin
  if cardinality(coalesce(new.requested_products, '{}'::text[])) > 1 then
    raise exception 'A partner must select exactly one operating model: API or white label'
      using errcode = '23514';
  end if;
  if new.status <> 'draft' and cardinality(coalesce(new.requested_products, '{}'::text[])) <> 1 then
    raise exception 'One partner operating model is required before submission'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_partner_application_single_product on public.partner_applications;
create trigger trg_partner_application_single_product
  before insert or update of requested_products, status on public.partner_applications
  for each row execute function public.enforce_single_partner_product();

create or replace function public.enforce_single_approved_partner_product()
returns trigger language plpgsql set search_path = public as $$
begin
  if cardinality(coalesce(new.approved_products, '{}'::text[])) <> 1 then
    raise exception 'Approved partner access must be API-only or white-label-only'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_api_partner_approval_single_product on public.api_partner_approvals;
create trigger trg_api_partner_approval_single_product
  before insert or update of approved_products on public.api_partner_approvals
  for each row execute function public.enforce_single_approved_partner_product();

create table if not exists public.partner_commercial_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete restrict,
  partner_model text not null check (partner_model in ('api','white_label')),
  volume_tier text not null default 'standard' check (volume_tier in ('standard','high_volume')),
  currency text not null default 'USD' check (currency = 'USD'),
  upfront_fee numeric(20,2) not null default 0 check (upfront_fee >= 0),
  monthly_fee numeric(20,2) not null default 0 check (monthly_fee >= 0),
  va_onramp_percent numeric(8,5) not null default 0 check (va_onramp_percent >= 0),
  external_fiat_offramp_percent numeric(8,5) not null default 0 check (external_fiat_offramp_percent >= 0),
  crypto_to_crypto_percent numeric(8,5) not null default 0 check (crypto_to_crypto_percent >= 0),
  african_rails_markup_percent numeric(8,5) not null default 0 check (african_rails_markup_percent >= 0),
  partner_developer_fee_percent numeric(8,5) not null default 0 check (partner_developer_fee_percent >= 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  nda_reference text not null,
  treasury_agreement_reference text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_commercial_terms_window check (effective_until is null or effective_until > effective_from),
  constraint partner_commercial_terms_model_prices check (
    (partner_model = 'api' and upfront_fee = 0 and monthly_fee = 0)
    or
    (partner_model = 'white_label' and upfront_fee > 0 and monthly_fee > 0)
  )
);
create unique index if not exists partner_commercial_terms_one_active_idx
  on public.partner_commercial_terms (organization_id) where is_active;

create table if not exists public.partner_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete restrict,
  invoice_number text not null unique,
  period_start date not null,
  period_end date not null,
  issued_at timestamptz,
  due_at timestamptz,
  currency text not null default 'USD' check (currency = 'USD'),
  subtotal numeric(20,2) not null default 0 check (subtotal >= 0),
  tax numeric(20,2) not null default 0 check (tax >= 0),
  total numeric(20,2) generated always as (subtotal + tax) stored,
  amount_paid numeric(20,2) not null default 0 check (amount_paid >= 0),
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','past_due','void')),
  payment_method text check (payment_method is null or payment_method in ('bank_transfer','flutterwave')),
  payment_reference text,
  payment_url text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_invoice_period check (period_end >= period_start),
  constraint partner_invoice_paid_limit check (amount_paid <= subtotal + tax)
);
create index if not exists partner_invoices_org_period_idx
  on public.partner_invoices (organization_id, period_end desc);

create table if not exists public.partner_invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.partner_invoices(id) on delete cascade,
  line_type text not null check (line_type in ('upfront_fee','monthly_fee','provider_usage','transaction_fee','email_usage','adjustment')),
  description text not null,
  provider text,
  product text,
  quantity numeric(30,8) not null default 1 check (quantity >= 0),
  unit_amount numeric(20,8) not null default 0 check (unit_amount >= 0),
  amount numeric(20,2) not null check (amount >= 0),
  allocation_basis text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists partner_invoice_lines_invoice_idx
  on public.partner_invoice_line_items (invoice_id, created_at);

create table if not exists public.partner_provider_invoices (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_invoice_number text not null,
  period_start date not null,
  period_end date not null,
  currency text not null default 'USD',
  total numeric(20,2) not null check (total >= 0),
  source_document_path text,
  status text not null default 'imported' check (status in ('imported','reconciled','disputed','settled')),
  imported_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint partner_provider_invoice_period check (period_end >= period_start),
  unique (provider, provider_invoice_number)
);

create table if not exists public.partner_provider_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  provider_invoice_id uuid not null references public.partner_provider_invoices(id) on delete restrict,
  organization_id uuid not null references public.partner_organizations(id) on delete restrict,
  partner_invoice_line_item_id uuid references public.partner_invoice_line_items(id) on delete set null,
  allocation_key text not null,
  quantity numeric(30,8) not null check (quantity >= 0),
  allocated_amount numeric(20,2) not null check (allocated_amount >= 0),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider_invoice_id, organization_id, allocation_key)
);

create table if not exists public.partner_developer_fee_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.partner_organizations(id) on delete restrict,
  tenant_id uuid not null references public.api_tenants(id) on delete restrict,
  provider text not null,
  provider_transaction_id text not null,
  source_event_id text not null,
  currency text not null,
  gross_partner_fee numeric(30,12) not null check (gross_partner_fee >= 0),
  reversal_amount numeric(30,12) not null default 0 check (reversal_amount >= 0),
  payable_amount numeric(30,12) generated always as (gross_partner_fee - reversal_amount) stored,
  state text not null check (state in ('pending','earned','reversed','payable','paid','held')),
  occurred_at timestamptz not null,
  paid_at timestamptz,
  payout_reference text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_developer_fee_reversal_limit check (reversal_amount <= gross_partner_fee),
  unique (tenant_id, source_event_id)
);
create index if not exists partner_developer_fee_org_state_idx
  on public.partner_developer_fee_ledger (organization_id, state, occurred_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'partner_commercial_terms','partner_invoices','partner_invoice_line_items',
    'partner_provider_invoices','partner_provider_cost_allocations','partner_developer_fee_ledger'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

drop trigger if exists trg_partner_commercial_terms_touch on public.partner_commercial_terms;
create trigger trg_partner_commercial_terms_touch before update on public.partner_commercial_terms
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_partner_invoices_touch on public.partner_invoices;
create trigger trg_partner_invoices_touch before update on public.partner_invoices
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_partner_developer_fee_touch on public.partner_developer_fee_ledger;
create trigger trg_partner_developer_fee_touch before update on public.partner_developer_fee_ledger
  for each row execute function public.touch_updated_at();

comment on table public.partner_provider_cost_allocations is
  'Operator-reviewed allocation of actual provider invoice costs. Never infer allocation from an aggregate provider bill.';
comment on table public.partner_developer_fee_ledger is
  'Partner payable ledger. Only terminal provider events may transition an entry to payable; this table never initiates a payout.';

create or replace function public.admin_set_partner_commercial_terms(
  p_organization_id uuid,
  p_partner_model text,
  p_volume_tier text,
  p_upfront_fee numeric,
  p_monthly_fee numeric,
  p_va_onramp_percent numeric,
  p_external_fiat_offramp_percent numeric,
  p_crypto_to_crypto_percent numeric,
  p_african_rails_markup_percent numeric,
  p_partner_developer_fee_percent numeric,
  p_effective_from timestamptz,
  p_nda_reference text,
  p_treasury_agreement_reference text,
  p_approved_by uuid
) returns public.partner_commercial_terms
language plpgsql security definer set search_path = public as $$
declare
  v_row public.partner_commercial_terms;
  v_org_model text;
begin
  select partner_model into v_org_model from public.partner_organizations where id = p_organization_id for update;
  if not found then raise exception 'Partner organization not found'; end if;
  if p_partner_model not in ('api','white_label') or (v_org_model is not null and v_org_model <> p_partner_model) then
    raise exception 'Commercial model must match the approved partner model';
  end if;
  if nullif(btrim(p_nda_reference), '') is null or nullif(btrim(p_treasury_agreement_reference), '') is null then
    raise exception 'Both NDA and Treasury Agreement references are required';
  end if;
  update public.partner_commercial_terms set is_active = false, effective_until = coalesce(effective_until, p_effective_from)
    where organization_id = p_organization_id and is_active;
  insert into public.partner_commercial_terms (
    organization_id, partner_model, volume_tier, upfront_fee, monthly_fee,
    va_onramp_percent, external_fiat_offramp_percent, crypto_to_crypto_percent,
    african_rails_markup_percent, partner_developer_fee_percent, effective_from,
    nda_reference, treasury_agreement_reference, approved_by
  ) values (
    p_organization_id, p_partner_model, p_volume_tier, p_upfront_fee, p_monthly_fee,
    p_va_onramp_percent, p_external_fiat_offramp_percent, p_crypto_to_crypto_percent,
    p_african_rails_markup_percent, p_partner_developer_fee_percent, p_effective_from,
    btrim(p_nda_reference), btrim(p_treasury_agreement_reference), p_approved_by
  ) returning * into v_row;
  update public.partner_organizations set partner_model = p_partner_model, commercial_status = 'signed', updated_at = now()
    where id = p_organization_id;
  return v_row;
end;
$$;
revoke all on function public.admin_set_partner_commercial_terms(uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,timestamptz,text,text,uuid) from public, anon, authenticated;
grant execute on function public.admin_set_partner_commercial_terms(uuid,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,timestamptz,text,text,uuid) to service_role;

create or replace function public.admin_create_partner_invoice(
  p_organization_id uuid,
  p_invoice_number text,
  p_period_start date,
  p_period_end date,
  p_due_at timestamptz,
  p_payment_method text,
  p_payment_reference text,
  p_payment_url text,
  p_lines jsonb,
  p_created_by uuid
) returns public.partner_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.partner_invoices;
  v_line jsonb;
  v_line_id uuid;
  v_allocation_id uuid;
  v_allocated_amount numeric;
  v_quantity numeric;
  v_unit_amount numeric;
  v_amount numeric;
  v_subtotal numeric := 0;
begin
  if p_period_end < p_period_start then raise exception 'Invoice period is invalid'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'At least one invoice line is required'; end if;
  if p_payment_method not in ('bank_transfer','flutterwave') then raise exception 'Payment method is invalid'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := coalesce((v_line->>'quantity')::numeric, 0);
    v_unit_amount := coalesce((v_line->>'unit_amount')::numeric, 0);
    if v_quantity < 0 or v_unit_amount < 0 or nullif(btrim(v_line->>'description'), '') is null then
      raise exception 'Invoice line is invalid';
    end if;
    v_subtotal := v_subtotal + round(v_quantity * v_unit_amount, 2);
  end loop;
  insert into public.partner_invoices (
    organization_id, invoice_number, period_start, period_end, issued_at, due_at,
    subtotal, tax, status, payment_method, payment_reference, payment_url, created_by
  ) values (
    p_organization_id, btrim(p_invoice_number), p_period_start, p_period_end, now(), p_due_at,
    v_subtotal, 0, 'issued', p_payment_method, nullif(btrim(p_payment_reference), ''),
    nullif(btrim(p_payment_url), ''), p_created_by
  ) returning * into v_invoice;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := coalesce((v_line->>'quantity')::numeric, 0);
    v_unit_amount := coalesce((v_line->>'unit_amount')::numeric, 0);
    v_amount := round(v_quantity * v_unit_amount, 2);
    if v_line->>'line_type' = 'provider_usage' then
      begin v_allocation_id := (v_line->'evidence'->>'allocation_id')::uuid;
      exception when others then raise exception 'Provider usage requires a valid allocation_id'; end;
      select allocated_amount into v_allocated_amount
        from public.partner_provider_cost_allocations
        where id = v_allocation_id and organization_id = p_organization_id
          and partner_invoice_line_item_id is null for update;
      if not found or v_allocated_amount <> v_amount then
        raise exception 'Provider allocation is unavailable or does not match the invoice amount';
      end if;
    else
      v_allocation_id := null;
    end if;
    insert into public.partner_invoice_line_items (
      invoice_id, line_type, description, provider, product, quantity, unit_amount,
      amount, allocation_basis, evidence
    ) values (
      v_invoice.id, v_line->>'line_type', btrim(v_line->>'description'),
      nullif(btrim(v_line->>'provider'), ''), nullif(btrim(v_line->>'product'), ''),
      v_quantity, v_unit_amount, v_amount, nullif(btrim(v_line->>'allocation_basis'), ''),
      coalesce(v_line->'evidence', '{}'::jsonb)
    ) returning id into v_line_id;
    if v_allocation_id is not null then
      update public.partner_provider_cost_allocations set partner_invoice_line_item_id = v_line_id where id = v_allocation_id;
    end if;
  end loop;
  return v_invoice;
end;
$$;
revoke all on function public.admin_create_partner_invoice(uuid,text,date,date,timestamptz,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.admin_create_partner_invoice(uuid,text,date,date,timestamptz,text,text,text,jsonb,uuid) to service_role;

create or replace function public.admin_allocate_partner_provider_cost(
  p_provider_invoice_id uuid,
  p_organization_id uuid,
  p_allocation_key text,
  p_quantity numeric,
  p_allocated_amount numeric,
  p_evidence jsonb
) returns public.partner_provider_cost_allocations
language plpgsql security definer set search_path = public as $$
declare
  v_invoice_total numeric;
  v_existing_total numeric;
  v_row public.partner_provider_cost_allocations;
begin
  select total into v_invoice_total from public.partner_provider_invoices where id = p_provider_invoice_id for update;
  if not found then raise exception 'Provider invoice not found'; end if;
  select coalesce(sum(allocated_amount), 0) into v_existing_total
    from public.partner_provider_cost_allocations where provider_invoice_id = p_provider_invoice_id;
  if p_quantity < 0 or p_allocated_amount < 0 or v_existing_total + p_allocated_amount > v_invoice_total then
    raise exception 'Allocation exceeds the provider invoice total';
  end if;
  if jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Tenant-owned provider resource evidence is required';
  end if;
  if jsonb_typeof(p_evidence->'provider_resource_ids') <> 'array' then
    raise exception 'Tenant-owned provider resource evidence is required';
  end if;
  if jsonb_array_length(p_evidence->'provider_resource_ids') = 0 then
    raise exception 'Tenant-owned provider resource evidence is required';
  end if;
  insert into public.partner_provider_cost_allocations (
    provider_invoice_id, organization_id, allocation_key, quantity, allocated_amount, evidence
  ) values (
    p_provider_invoice_id, p_organization_id, btrim(p_allocation_key), p_quantity, p_allocated_amount, p_evidence
  ) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.admin_allocate_partner_provider_cost(uuid,uuid,text,numeric,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.admin_allocate_partner_provider_cost(uuid,uuid,text,numeric,numeric,jsonb) to service_role;

commit;
