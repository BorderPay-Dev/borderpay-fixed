begin;
create table public.predeposit_worker_requests(
 id bigint generated always as identity primary key,
 request_id bigint not null,
 requested_at timestamptz not null default now()
);
alter table public.predeposit_worker_requests enable row level security;
grant select on public.predeposit_worker_requests to service_role;
create function public.invoke_predeposit_worker() returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_token text; v_request bigint;
begin
 if not exists(select 1 from public.predeposit_invoices where status in ('queued','screening') and (lease_until is null or lease_until<now())) then return null;end if;
 if not pg_try_advisory_xact_lock(hashtext('predeposit-worker-dispatch')) then return null;end if;
 select decrypted_secret into v_token from vault.decrypted_secrets where name='borderpay_predeposit_worker_token' limit 1;
 if v_token is null or length(v_token)<32 then raise exception 'Pre-deposit worker credential is not configured';end if;
 select net.http_post(
  url:='https://orwrcpwsffjlvzuraxjc.supabase.co/functions/v1/predeposit-worker',
  headers:=jsonb_build_object('Content-Type','application/json','X-Predeposit-Worker-Token',v_token),
  body:='{}'::jsonb,timeout_milliseconds:=10000
 ) into v_request;
 insert into public.predeposit_worker_requests(request_id) values(v_request);
 return v_request;
end;$$;
revoke all on function public.invoke_predeposit_worker() from public,anon,authenticated;
grant execute on function public.invoke_predeposit_worker() to service_role;
commit;
