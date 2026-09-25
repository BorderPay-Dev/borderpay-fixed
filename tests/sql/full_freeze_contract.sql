do $$ begin
 assert (select account_status='frozen' and account_frozen_at='2026-09-01T00:00:00Z' from user_profiles where bridge_customer_id='paused-business'),'backfill uses existing freeze';
 assert (select account_status='active' from user_profiles where bridge_customer_id='active-individual'),'active accounts unchanged';
 assert (select account_status='closed' from user_profiles where bridge_customer_id='closed-business'),'terminal state preserved';
 assert (select account_frozen_at='2026-08-01T00:00:00Z' and account_frozen_reason='provider fraud alert hold: existing evidence' from user_profiles where bridge_customer_id='fraud-business'),'fraud evidence preserved';
 assert not has_function_privilege('authenticated','public.ingest_bridge_event(text,text,boolean,jsonb,text)','execute'),'customer cannot invoke ingest';
 assert not has_function_privilege('anon','public.ingest_bridge_event(text,text,boolean,jsonb,text)','execute'),'anonymous cannot invoke ingest';
 assert has_function_privilege('service_role','public.ingest_bridge_event(text,text,boolean,jsonb,text)','execute'),'receiver can invoke ingest';
 begin perform paused_account_wallet_summary(); raise exception 'missing auth accepted'; exception when raise_exception then if sqlerrm <> 'AUTH_REQUIRED' then raise; end if; end;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 assert paused_account_wallet_summary()='{"mode":"locked"}'::jsonb,'summary must not expose wallets or accounts';
end $$;
select * from ingest_bridge_event('bad-signature','customer.updated.status_transitioned',false,'{"event_object_id":"active-individual","event_object_status":"paused"}','hash');
select * from ingest_bridge_event('null-signature','customer.updated.status_transitioned',null,'{"event_object_id":"active-individual","event_object_status":"paused"}','hash');
select * from ingest_bridge_event('va-only','virtual_account.updated.status_transitioned',true,'{"event_object_id":"active-individual","event_object_status":"paused"}','hash');
select * from ingest_bridge_event('old-business','customer.updated.status_transitioned',true,'{"event_object_id":"old-business-id","event_object_status":"paused"}','hash');
do $$ begin
 assert (select account_status='active' from user_profiles where bridge_customer_id='active-individual'),'non-customer and unsigned events do not freeze';
 assert (select account_status='active' from user_profiles where bridge_customer_id='old-business-id'),'stale business mapping must not freeze';
end $$;
select * from ingest_bridge_event('real-pause','customer.updated.status_transitioned',true,'{"event_object_id":"active-individual","event_object_status":"paused"}','hash');
select * from ingest_bridge_event('business-pause','customer.updated.status_transitioned',true,'{"event_object_id":"effective-business-id","event_object_status":"paused"}','hash');
select * from ingest_bridge_event('fraud-pause','customer.updated.status_transitioned',true,'{"event_object_id":"fraud-business","event_object_status":"paused"}','hash');
do $$ declare d timestamptz; r record; begin
 assert (select account_status='frozen' and account_frozen_at is not null and bridge_account_status='paused' from user_profiles where bridge_customer_id='active-individual'),'individual frozen at ingest';
 assert (select account_status='frozen' from user_profiles where bridge_customer_id='old-business-id'),'business effective mapping frozen';
 assert (select account_frozen_at='2026-08-01T00:00:00Z' and account_frozen_reason='provider fraud alert hold: existing evidence' from user_profiles where bridge_customer_id='fraud-business'),'repeat pause preserves fraud evidence';
 select account_frozen_at into d from user_profiles where bridge_customer_id='active-individual';
 select * into r from ingest_bridge_event('real-pause','customer.updated.status_transitioned',true,'{"event_object_id":"active-individual","event_object_status":"paused"}','hash');
 assert r.was_duplicate,'duplicate must retain idempotency';
 assert (select count(*)=1 from pending_events where event_id='bridge:real-pause'),'no duplicate queue';
 assert (select account_frozen_at=d from user_profiles where bridge_customer_id='active-individual'),'freeze timestamp unchanged';
 perform ingest_bridge_event('active-again','customer.updated.status_transitioned',true,'{"event_object_id":"active-individual","event_object_status":"active"}','hash');
 assert (select account_status='frozen' from user_profiles where bridge_customer_id='active-individual'),'no automatic unfreeze';
end $$;
create function reject_test_queue() returns trigger language plpgsql as $$ begin if new.event_id='bridge:queue-fail' then raise exception 'synthetic queue failure'; end if; return new; end $$;
create trigger reject_test_queue before insert on pending_events for each row execute function reject_test_queue();
do $$ begin
 begin
  perform ingest_bridge_event('queue-fail','customer.updated.status_transitioned',true,'{"event_object_id":"rollback-individual","event_object_status":"paused"}','hash');
  raise exception 'queue failure was ignored';
 exception when raise_exception then if sqlerrm <> 'synthetic queue failure' then raise; end if; end;
 assert (select account_status='active' and account_frozen_at is null from user_profiles where bridge_customer_id='rollback-individual'),'failed transaction must roll back partial freeze';
 assert not exists(select 1 from bridge_webhook_events where event_id='queue-fail'),'event insert rolls back for retry';
 assert not exists(select 1 from webhook_logs where event_id='bridge:queue-fail'),'queue parent rolls back for retry';
end $$;
select 'PASS: full freeze, mappings, signature rejection, grants, duplicate delivery, fraud preservation, no auto-unlock and atomic rollback' as result;

-- Exercise the existing guard under the role used by PostgREST customers.
begin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 update user_profiles set updated_at=now() where bridge_customer_id='active-individual';
 begin
  update user_profiles set account_status='active',account_frozen_at=null where bridge_customer_id='active-individual';
  raise exception 'customer cleared full freeze';
 exception when insufficient_privilege then
  assert sqlerrm='Compliance-managed account status fields cannot be changed by the customer.','must be denied by the existing compliance guard';
 end;
 begin
  update user_profiles set bridge_account_status='active' where bridge_customer_id='active-individual';
  raise exception 'customer forged provider status';
 exception when insufficient_privilege then
  assert sqlerrm='Compliance-managed account status fields cannot be changed by the customer.';
 end;
 assert (select account_status='frozen' and bridge_account_status='paused' from user_profiles where bridge_customer_id='active-individual');
end $$;
rollback;
-- The verified admin and backend paths remain functional.
begin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
set local role authenticated;
update user_profiles set account_frozen_reason='authorized admin note' where bridge_customer_id='active-individual';
rollback;
begin;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
update user_profiles set account_frozen_reason='authorized backend note' where bridge_customer_id='active-individual';
rollback;
select 'PASS: customers cannot clear local freeze or forge provider status; backend/admin updates work' as result;
