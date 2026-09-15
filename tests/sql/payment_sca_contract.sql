-- Behavioral checks against a disposable PostgreSQL instance.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into public.user_security(user_id) values ('00000000-0000-4000-8000-000000000001');
insert into public.sca_authorizations(id,user_id,operation,resource,payload_hash,verified_factors,expires_at)
values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','payment','bridge_transfer',repeat('a',64),array['pin','totp'],now()+interval '4 minutes');

do $$
declare
  u uuid := '00000000-0000-4000-8000-000000000001';
  a uuid := '00000000-0000-4000-8000-000000000002';
begin
  if has_function_privilege('authenticated','public.consume_sca_authorization(uuid,uuid,text,text,text)','execute')
     or has_function_privilege('anon','public.consume_totp_counter(uuid,bigint)','execute') then
    raise exception 'client role can forge SCA consumption';
  end if;
  if not public.consume_totp_counter(u, 100) then raise exception 'first TOTP rejected'; end if;
  if public.consume_totp_counter(u, 100) or public.consume_totp_counter(u, 99) then raise exception 'TOTP replay accepted'; end if;
  if not public.consume_totp_counter(u, 101) then raise exception 'new TOTP rejected'; end if;
  if public.consume_sca_authorization(a,u,'payment','bridge_transfer',repeat('b',64)) then raise exception 'changed payload accepted'; end if;
  if exists(select 1 from public.sca_authorizations where id=a and consumed_at is not null) then raise exception 'invalid request consumed authorization'; end if;
  if not public.consume_sca_authorization(a,u,'payment','bridge_transfer',repeat('a',64)) then raise exception 'valid authorization rejected'; end if;
  if public.consume_sca_authorization(a,u,'payment','bridge_transfer',repeat('a',64)) then raise exception 'authorization replay accepted'; end if;
  if (select count(*) from public.sca_audit_events where authorization_id=a and event_type='authorization_consumed') <> 1 then raise exception 'missing or duplicate consume evidence'; end if;
end;
$$;

insert into public.sca_authorizations(id,user_id,operation,resource,payload_hash,verified_factors,created_at,expires_at)
values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','payment','bridge_transfer',repeat('a',64),array['pin','totp'],now()-interval '4 minutes',now()-interval '1 minute');
do $$ begin
  if public.consume_sca_authorization('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','payment','bridge_transfer',repeat('a',64)) then raise exception 'expired authorization accepted'; end if;
end $$;

insert into public.sca_authorizations(id,user_id,operation,resource,payload_hash,verified_factors,expires_at)
values ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','payment','bridge_transfer',repeat('a',64),array['pin','totp'],now()+interval '4 minutes');
create function public.test_reject_sca_audit() returns trigger language plpgsql as $$ begin raise exception 'test_audit_write_failed'; end; $$;
create trigger test_reject_sca_audit before insert on public.sca_audit_events for each row execute function public.test_reject_sca_audit();
do $$ begin
  begin
    perform public.consume_sca_authorization('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','payment','bridge_transfer',repeat('a',64));
    raise exception 'audit failure did not abort authorization';
  exception when others then
    if sqlerrm <> 'test_audit_write_failed' then raise; end if;
  end;
  if exists(select 1 from public.sca_authorizations where id='00000000-0000-4000-8000-000000000004' and consumed_at is not null) then raise exception 'failed evidence write left authorization consumed'; end if;
end $$;
drop trigger test_reject_sca_audit on public.sca_audit_events;

insert into public.transactions values ('00000000-0000-4000-8000-000000000005','bridge',jsonb_build_object('idempotency_key','original-key','sca_required',true,'sca_authorization_id','00000000-0000-4000-8000-000000000002','sca_attestation_outcome','sca_used','sca_country','IT'));
update public.transactions set metadata='{"raw":{"state":"completed"},"sca_required":false,"idempotency_key":"replacement-key"}' where id='00000000-0000-4000-8000-000000000005';
do $$ declare m jsonb; begin
  select metadata into m from public.transactions where id='00000000-0000-4000-8000-000000000005';
  if m->>'sca_attestation_outcome' <> 'sca_used' or m->>'sca_required' <> 'true' or m->>'idempotency_key' <> 'original-key' or m#>>'{raw,state}' <> 'completed' then raise exception 'webhook update erased SCA evidence or new provider state'; end if;
end $$;
rollback;
select 'PASS: SCA replay, expiry, role restrictions, atomic evidence and webhook retention' as result;
