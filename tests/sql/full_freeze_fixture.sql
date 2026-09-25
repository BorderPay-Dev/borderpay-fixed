create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.user_profiles(id uuid primary key,account_type text,account_status text,account_frozen_at timestamptz,account_frozen_reason text,account_frozen_by uuid,bridge_customer_id text,bridge_account_status text,bridge_account_paused_at timestamptz,updated_at timestamptz default now());
create table public.business_profiles(user_id uuid primary key,bridge_customer_id text);
create table public.webhook_logs(event_id text primary key,source text,event_type text,status text,signature_ok boolean,payload_hash text,received_at timestamptz,queued_at timestamptz,pending_event_id uuid);
create table public.pending_events(id uuid primary key default gen_random_uuid(),event_id text unique references public.webhook_logs(event_id),source text,event_type text,payload jsonb,status text);
create table public.bridge_webhook_events(id uuid primary key default gen_random_uuid(),event_id text unique,event_type text,signature_ok boolean,payload jsonb,payload_hash text,processing_status text,last_error text,received_at timestamptz,queued_at timestamptz,pending_event_id uuid);
insert into user_profiles(id,account_type,account_status,bridge_customer_id,bridge_account_status,bridge_account_paused_at) values
 ('00000000-0000-4000-8000-000000000001','business','active','paused-business','paused','2026-09-01T00:00:00Z'),
 ('00000000-0000-4000-8000-000000000002','individual','active','active-individual','active',null),
 ('00000000-0000-4000-8000-000000000003','business','active','old-business-id','active',null),
 ('00000000-0000-4000-8000-000000000004','business','frozen','fraud-business','paused','2026-08-01T00:00:00Z'),
 ('00000000-0000-4000-8000-000000000005','individual','active','rollback-individual','active',null),
 ('00000000-0000-4000-8000-000000000006','business','closed','closed-business','paused',null);
update user_profiles set account_frozen_at='2026-08-01T00:00:00Z',account_frozen_reason='provider fraud alert hold: existing evidence' where id='00000000-0000-4000-8000-000000000004';
insert into business_profiles values ('00000000-0000-4000-8000-000000000003','effective-business-id');

create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'') $$;
create function public.is_borderpay_admin() returns boolean language sql stable as $$ select auth.uid()='00000000-0000-4000-8000-000000000099'::uuid $$;
CREATE OR REPLACE FUNCTION public.guard_user_profile_compliance_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_is_admin boolean := false;
begin
  if v_role = 'service_role' or current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  begin
    v_is_admin := public.is_borderpay_admin();
  exception when others then
    v_is_admin := false;
  end;
  if v_is_admin then
    return new;
  end if;

  if new.account_status is distinct from old.account_status
     or new.account_frozen_at is distinct from old.account_frozen_at
     or new.account_frozen_reason is distinct from old.account_frozen_reason
     or new.account_frozen_by is distinct from old.account_frozen_by
     or new.bridge_account_status is distinct from old.bridge_account_status
     or new.bridge_account_paused_at is distinct from old.bridge_account_paused_at
  then
    raise exception using
      errcode = '42501',
      message = 'Compliance-managed account status fields cannot be changed by the customer.';
  end if;

  return new;
end;
$function$;
create trigger trg_guard_user_profile_compliance_status before update on user_profiles for each row execute function public.guard_user_profile_compliance_status();
grant usage on schema public,auth to authenticated,service_role;
grant select,update on public.user_profiles to authenticated,service_role;
