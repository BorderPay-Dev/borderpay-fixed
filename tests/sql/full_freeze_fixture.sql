create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.user_profiles(id uuid primary key,account_type text,account_status text,account_frozen_at timestamptz,account_frozen_reason text,bridge_customer_id text,bridge_account_status text,bridge_account_paused_at timestamptz,updated_at timestamptz default now());
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
