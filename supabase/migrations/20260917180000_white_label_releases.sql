begin;
-- A draft never changes the published customer app. Only the service/operator
-- publication workflow may set live after domain and launch verification.
create table if not exists public.white_label_releases (
  tenant_id uuid primary key references public.api_tenants(id),
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  app_origin text unique,
  status text not null default 'draft' check (status in ('draft','review','pilot','live','suspended')),
  revision integer not null default 0,
  domain_challenge uuid not null default gen_random_uuid(),
  domain_verified_at timestamptz,
  managed_key_id uuid references public.api_keys(id),
  pilot_emails text[] not null default ARRAY[]::text[],
  launch_evidence jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  review_requested_at timestamptz,
  updated_at timestamptz not null default now(),
  check (status not in ('live','pilot') or (published is not null and app_origin is not null and domain_verified_at is not null and managed_key_id is not null and published_at is not null))
);
alter table public.white_label_releases enable row level security;
revoke all on public.white_label_releases from anon, authenticated;
grant all on public.white_label_releases to service_role;
drop policy if exists white_label_releases_service on public.white_label_releases;
create policy white_label_releases_service on public.white_label_releases for all to service_role using (true) with check (true);
create table if not exists public.white_label_legal_acceptances (
  authorization_id uuid primary key references public.api_onboarding_authorizations(id),
  tenant_id uuid not null references public.api_tenants(id),
  release_revision integer not null,
  legal_version text not null,
  terms_url text not null,
  privacy_url text not null,
  app_origin text not null,
  accepted_at timestamptz not null default now()
);
alter table public.white_label_legal_acceptances enable row level security;
revoke all on public.white_label_legal_acceptances from anon, authenticated;
grant all on public.white_label_legal_acceptances to service_role;
drop policy if exists white_label_legal_acceptances_service on public.white_label_legal_acceptances;
create policy white_label_legal_acceptances_service on public.white_label_legal_acceptances for all to service_role using (true) with check (true);
comment on table public.white_label_legal_acceptances is 'Partner legal acceptance joined to immutable account origin by authorization_id. Does not replace Bridge ToS acceptance.';
create table if not exists public.white_label_release_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.api_tenants(id),
  revision integer not null,
  status text not null,
  published jsonb,
  evidence jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.white_label_release_history enable row level security;
revoke all on public.white_label_release_history from anon, authenticated;
grant all on public.white_label_release_history to service_role;
drop policy if exists white_label_release_history_service on public.white_label_release_history;
create policy white_label_release_history_service on public.white_label_release_history for all to service_role using(true) with check(true);
create or replace function public.record_white_label_release() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.published is distinct from old.published or new.status is distinct from old.status then
  insert into public.white_label_release_history(tenant_id,revision,status,published,evidence) values(new.tenant_id,new.revision,new.status,new.published,new.launch_evidence);
 end if;
 return new;
end; $$;
revoke all on function public.record_white_label_release() from public;
drop trigger if exists white_label_release_audit on public.white_label_releases;
create trigger white_label_release_audit after update on public.white_label_releases for each row execute function public.record_white_label_release();
-- Read-only customer-app records are joined through immutable tenant provenance.
-- Only the authenticated partner backend may call this RPC after membership checks.
create or replace function public.white_label_workspace_resources(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with owners as (
  select user_id from public.account_origin_provenance where tenant_id=p_tenant_id and onboarding_channel='white_label'
 ), resources as (
  select 'customer:'||u.id::text id, 'customer'::text resource_type,
   coalesce(nullif(u.bridge_customer_id,''),u.id::text) provider_resource_id,
   u.full_name display_name, u.account_status::text state, null::numeric amount,
   null::text source_currency, u.created_at
  from public.user_profiles u where exists(select 1 from owners o where o.user_id=u.id)
  union all
  select 'wallet:'||w.id::text, 'wallet',w.bridge_wallet_id,upper(w.currency)||' / '||w.chain,w.status,null::numeric,upper(w.currency),w.created_at
  from public.bridge_wallets w where exists(select 1 from owners o where (w.user_id=o.user_id and (w.business_user_id is null or w.business_user_id=o.user_id)) or (w.business_user_id=o.user_id and w.user_id is null))
  union all
  select 'virtual_account:'||v.id::text,'virtual_account',v.bridge_virtual_account_id,upper(v.currency)||' receiving account',v.status,null::numeric,upper(v.currency),v.created_at
  from public.bridge_virtual_accounts v where exists(select 1 from owners o where (v.user_id=o.user_id and (v.business_user_id is null or v.business_user_id=o.user_id)) or (v.business_user_id=o.user_id and v.user_id is null))
  union all
  select 'transaction:'||t.id::text,'transfer',coalesce(t.bridge_transfer_id,t.id::text),null::text,t.status::text,t.amount,t.currency,t.created_at
  from public.transactions t where exists(select 1 from owners o where o.user_id=t.user_id)
 ), recent as (select distinct * from resources order by created_at desc limit 500)
 select coalesce(jsonb_agg(to_jsonb(recent)),'[]'::jsonb) from recent;
$$;
revoke all on function public.white_label_workspace_resources(uuid) from public, anon, authenticated;
grant execute on function public.white_label_workspace_resources(uuid) to service_role;
commit;
