-- Ordinary BorderPay Business accounts are not API/white-label partners.
-- Partner access requires a separate, durable operator approval. Existing
-- tenants are intentionally not backfilled: absence of a row fails closed.

create table if not exists public.api_partner_approvals (
  tenant_id                       uuid primary key references public.api_tenants(id) on delete restrict,
  status                          text not null check (status in ('approved','suspended','rejected')),
  partner_type                    text not null,
  approved_products               text[] not null,
  approved_use_case               text not null,
  technical_contact_email         text not null,
  compliance_contact_email        text not null,
  incident_contact_email          text not null,
  compliance_approval_reference   text not null,
  engineering_approval_reference  text not null,
  compliance_approved_by          text not null,
  engineering_approved_by         text not null,
  recorded_by                     text not null,
  approved_at                     timestamptz not null,
  suspended_at                    timestamptz,
  suspended_by                    text,
  suspension_reason               text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint api_partner_approvals_products_nonempty
    check (cardinality(approved_products) > 0),
  constraint api_partner_approvals_products_allowed
    check (approved_products <@ array['api','white_label']::text[]),
  constraint api_partner_approvals_contact_email_format
    check (
      technical_contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and
      compliance_contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and
      incident_contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint api_partner_approvals_suspension_complete
    check (
      (status <> 'suspended') or
      (suspended_at is not null and suspended_by is not null and suspension_reason is not null)
    )
);

alter table public.api_partner_approvals enable row level security;

drop policy if exists api_partner_approvals_service_role on public.api_partner_approvals;
create policy api_partner_approvals_service_role on public.api_partner_approvals
  for all to service_role using (true) with check (true);

drop policy if exists api_partner_approvals_admin_read on public.api_partner_approvals;
create policy api_partner_approvals_admin_read on public.api_partner_approvals
  for select to authenticated using (public.is_borderpay_admin());

drop trigger if exists trg_api_partner_approvals_touch on public.api_partner_approvals;
create trigger trg_api_partner_approvals_touch
  before update on public.api_partner_approvals
  for each row execute function public.touch_updated_at();

drop function if exists public.api_gateway_resolve_api_key(text);
create function public.api_gateway_resolve_api_key(p_key_hash text)
returns table (
  api_key_id uuid,
  tenant_id uuid,
  tenant_name text,
  default_mode text,
  rate_limit_per_minute integer,
  beta_access_enabled boolean,
  max_single_transfer_usd numeric,
  tenant_metadata jsonb,
  scopes text[]
)
language sql
security definer
set search_path = public
as $$
  select
    k.id,
    t.id,
    t.tenant_name,
    t.default_mode,
    t.rate_limit_per_minute,
    t.beta_access_enabled,
    t.max_single_transfer_usd,
    coalesce(t.metadata, '{}'::jsonb),
    k.scopes
  from public.api_keys k
  join public.api_tenants t on t.id = k.tenant_id
  join public.api_partner_approvals a on a.tenant_id = t.id
  where k.key_hash = p_key_hash
    and k.is_active = true
    and k.revoked_at is null
    and t.is_active = true
    and a.status = 'approved'
    and cardinality(a.approved_products) > 0
    and (
      'api' = any(a.approved_products) or
      (
        'white_label' = any(a.approved_products) and
        k.scopes <@ array['onboarding:write']::text[] and
        cardinality(k.scopes) > 0
      )
    )
  limit 1;
$$;

revoke all on function public.api_gateway_resolve_api_key(text) from public, anon, authenticated;
grant execute on function public.api_gateway_resolve_api_key(text) to service_role;

create or replace function public.consume_api_onboarding_authorization(
  p_token_hash text,
  p_account_type public.account_type
)
returns table (
  authorization_id uuid,
  tenant_id uuid,
  api_key_id uuid,
  external_user_id text,
  onboarding_channel text,
  allowed_account_types public.account_type[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_onboarding_authorizations%rowtype;
begin
  update public.api_onboarding_authorizations a
     set used_at = now()
   where a.token_hash = p_token_hash
     and a.used_at is null
     and a.expires_at > now()
     and p_account_type = any(a.allowed_account_types)
     and exists (
       select 1
       from public.api_tenants t
       join public.api_partner_approvals pa on pa.tenant_id = t.id
       where t.id = a.tenant_id
         and t.is_active = true
         and pa.status = 'approved'
         and 'white_label' = any(pa.approved_products)
     )
     and exists (
       select 1 from public.api_keys k
        where k.id = a.api_key_id
          and k.tenant_id = a.tenant_id
          and k.is_active = true
          and k.revoked_at is null
     )
  returning a.* into v_row;

  if not found then return; end if;

  insert into public.api_onboarding_audit (
    tenant_id, api_key_id, authorization_id, external_user_id,
    event_type, account_type, onboarding_channel
  ) values (
    v_row.tenant_id, v_row.api_key_id, v_row.id, v_row.external_user_id,
    'authorization_consumed', p_account_type, v_row.onboarding_channel
  );

  return query select v_row.id, v_row.tenant_id, v_row.api_key_id,
    v_row.external_user_id, v_row.onboarding_channel, v_row.allowed_account_types;
end;
$$;

revoke all on function public.consume_api_onboarding_authorization(text, public.account_type) from public, anon, authenticated;
grant execute on function public.consume_api_onboarding_authorization(text, public.account_type) to service_role;
