-- Authoritative tenant ownership for provider resources created through the
-- public API. Additive and fail-closed: legacy provider ids are not inferred
-- from mutable profile metadata and remain unavailable until explicitly bound
-- by an authorized migration/reconciliation process.

alter table public.api_tenant_end_users
  add constraint api_tenant_end_users_id_tenant_unique unique (id, tenant_id);

create table public.api_tenant_provider_resources (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.api_tenants(id) on delete restrict,
  tenant_end_user_id       uuid not null,
  created_by_api_key_id    uuid references public.api_keys(id) on delete set null,
  provider                 text not null default 'bridge' check (provider = 'bridge'),
  resource_type            text not null check (resource_type in (
    'customer', 'wallet', 'virtual_account', 'external_account',
    'deposit', 'transfer'
  )),
  provider_resource_id     text not null check (btrim(provider_resource_id) <> ''),
  parent_resource_id       uuid references public.api_tenant_provider_resources(id) on delete restrict,
  provider_status          text,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint api_tenant_provider_resources_end_user_tenant_fk
    foreign key (tenant_end_user_id, tenant_id)
    references public.api_tenant_end_users(id, tenant_id) on delete restrict,
  constraint api_tenant_provider_resources_provider_identity_unique
    unique (provider, resource_type, provider_resource_id)
);

create index api_tenant_provider_resources_tenant_user_idx
  on public.api_tenant_provider_resources (tenant_id, tenant_end_user_id, resource_type);
create index api_tenant_provider_resources_parent_idx
  on public.api_tenant_provider_resources (parent_resource_id)
  where parent_resource_id is not null;

alter table public.api_tenant_provider_resources enable row level security;

create policy api_tenant_provider_resources_service_role
  on public.api_tenant_provider_resources
  for all to service_role using (true) with check (true);

create policy api_tenant_provider_resources_admin_read
  on public.api_tenant_provider_resources
  for select to authenticated using (public.is_borderpay_admin());

create trigger trg_api_tenant_provider_resources_touch
  before update on public.api_tenant_provider_resources
  for each row execute function public.touch_updated_at();

-- Resolve only when the provider resource belongs to the authenticated
-- tenant. A resource belonging to another tenant is deliberately
-- indistinguishable from an unknown resource to the caller.
create function public.api_gateway_assert_tenant_resource(
  p_tenant_id uuid,
  p_provider text,
  p_resource_type text,
  p_provider_resource_id text
)
returns table (
  resource_id uuid,
  tenant_end_user_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.tenant_end_user_id
  from public.api_tenant_provider_resources r
  where r.tenant_id = p_tenant_id
    and r.provider = p_provider
    and r.resource_type = p_resource_type
    and r.provider_resource_id = p_provider_resource_id
  limit 1;
$$;

revoke all on function public.api_gateway_assert_tenant_resource(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_gateway_assert_tenant_resource(uuid, text, text, text)
  to service_role;

-- Registration is atomic and refuses to reassign an existing provider id to
-- another tenant or end user. Parent resources must be owned by the same
-- tenant and end user.
create function public.api_gateway_register_tenant_resource(
  p_tenant_id uuid,
  p_tenant_end_user_id uuid,
  p_api_key_id uuid,
  p_provider text,
  p_resource_type text,
  p_provider_resource_id text,
  p_parent_resource_id uuid default null,
  p_provider_status text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.api_tenant_end_users u
    where u.id = p_tenant_end_user_id and u.tenant_id = p_tenant_id
  ) then
    raise exception 'tenant end user ownership mismatch' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.api_keys k
    where k.id = p_api_key_id
      and k.tenant_id = p_tenant_id
      and k.is_active = true
      and k.revoked_at is null
  ) then
    raise exception 'api key ownership mismatch' using errcode = '42501';
  end if;

  if p_parent_resource_id is not null and not exists (
    select 1 from public.api_tenant_provider_resources parent
    where parent.id = p_parent_resource_id
      and parent.tenant_id = p_tenant_id
      and parent.tenant_end_user_id = p_tenant_end_user_id
  ) then
    raise exception 'parent resource ownership mismatch' using errcode = '42501';
  end if;

  insert into public.api_tenant_provider_resources (
    tenant_id, tenant_end_user_id, created_by_api_key_id, provider,
    resource_type, provider_resource_id, parent_resource_id,
    provider_status, metadata
  ) values (
    p_tenant_id, p_tenant_end_user_id, p_api_key_id, p_provider,
    p_resource_type, p_provider_resource_id, p_parent_resource_id,
    p_provider_status, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider, resource_type, provider_resource_id) do nothing
  returning id into v_id;

  if v_id is null then
    select r.id into v_id
    from public.api_tenant_provider_resources r
    where r.provider = p_provider
      and r.resource_type = p_resource_type
      and r.provider_resource_id = p_provider_resource_id
      and r.tenant_id = p_tenant_id
      and r.tenant_end_user_id = p_tenant_end_user_id
      and r.parent_resource_id is not distinct from p_parent_resource_id;

    if v_id is null then
      raise exception 'provider resource is already bound to different ownership'
        using errcode = '42501';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.api_gateway_register_tenant_resource(
  uuid, uuid, uuid, text, text, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.api_gateway_register_tenant_resource(
  uuid, uuid, uuid, text, text, text, uuid, text, jsonb
) to service_role;
