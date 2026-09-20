import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create table public.admin_users(user_id uuid primary key,role text);
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table user_profiles(id uuid primary key,account_type text);
 create table bridge_virtual_accounts(user_id uuid,business_user_id uuid,bridge_customer_id text,bridge_virtual_account_id text,currency text);
 create table bridge_webhook_events(event_id text primary key,event_type text,signature_ok boolean,payload jsonb,received_at timestamptz);
 `);
 for(const name of ['20260920010000_predeposit_evidence_foundation.sql','20260920020000_predeposit_workflow.sql','20260920100000_predeposit_deposit_reconciliation.sql']){
  await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 }
 const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
 const sha='a'.repeat(64),start='2026-09-20T00:00:00Z',approved='2026-09-20T01:00:00Z',time='2026-09-20T02:00:00Z';
 await db.query('insert into auth.users values($1),($2)',[owner,other]);
 await db.query("insert into user_profiles values($1,'business'),($2,'business')",[owner,other]);
 await db.query("insert into bridge_virtual_accounts values(null,$1,'customer','va-eur','EUR'),(null,$2,'other-customer','va-other','EUR')",[owner,other]);
 const invoice=async(no,patch={})=>{
  const payload={receiving_account_id:'va-eur',buyer:{legal_name:'Buyer Ltd',type:'company'},remitter:{legal_name:'Buyer Ltd',type:'company'},...patch};
  const row=(await db.query(`insert into predeposit_invoices(owner_user_id,invoice_number,revision,currency,total_minor,buyer_identity_hash,payload,payload_sha256,policy_version,status,dossier_path,dossier_sha256,approval_expires_at,review_context,created_at)
   values($1,$2,1,'EUR',10000,$3,$4,$3,'policy','approved','private/dossier.pdf',$3,'2026-09-27', '{"provider_customer_id":"customer"}',$5) returning id`,[owner,no,sha,JSON.stringify(payload),approved])).rows[0];
  await db.query(`insert into predeposit_reviews(invoice_id,payload_sha256,policy_version,actor_type,decision,assessment,rationale,created_at) values($1,$2,'policy','engine','approved','{}','Fixture approved before deposit',$3)`,[row.id,sha,approved]);
  await db.query("insert into predeposit_access_log(invoice_id,actor_user_id,action,metadata,created_at) values($1,$2,'payment_instructions_exported','{\"account_id\":\"va-eur\"}',$3)",[row.id,owner,approved]);
  return row.id;
 };
 const event=async(id,changes={},signature=true,eventTime=time)=>{
  const object={id:'activity-'+id,type:'funds_received',customer_id:'customer',deposit_id:'deposit-'+id,virtual_account_id:'va-eur',currency:'eur',amount:'100.00',source:{sender_name:'Buyer Ltd'},...changes};
  const payload={event_id:id,event_type:'virtual_account.activity.created',event_created_at:eventTime,event_object:object};
  await db.query('insert into bridge_webhook_events values($1,$2,$3,$4,$5)',[id,payload.event_type,signature,JSON.stringify(payload),time]);
 };
 const run=async()=>(await db.query('select reconcile_predeposit_bridge_events() result')).rows[0].result;
 const observation=async(id)=>(await db.query('select * from predeposit_deposit_observations where webhook_event_id=$1',[id])).rows[0];
 await invoice('INV-1');await event('first');
 assert.equal((await run()).enabled,false);
 assert.equal((await db.query('select count(*)::int n from predeposit_deposit_observations')).rows[0].n,0);
 await db.query("update predeposit_policy set mode='observe',config=$1",[JSON.stringify({deposit_reconciliation_enabled:true,deposit_reconciliation_start_at:start})]);
 assert.equal((await run()).matched,1);assert.equal((await observation('first')).amount_minor,10000);
 assert.equal((await run()).processed,0,'same event is idempotent');
 await event('settled',{type:'payment_processed',deposit_id:'deposit-first',currency:'usdc',amount:'114.82',receipt:{initial_amount:'100.00'}});
 assert.equal((await run()).matched,1,'converted settlement matches original EUR source amount');
 assert.equal((await observation('settled')).reason,'existing_deposit_binding');
 await event('reused');assert.equal((await run()).review_required,1,'new deposit cannot reuse consumed invoice');
 await event('conflict',{deposit_id:'deposit-first',amount:'101.00'});await run();
 assert.equal((await observation('conflict')).reason,'deposit_evidence_conflict');
 await event('missing-source',{type:'payment_processed',currency:'usdc',amount:'100.00'});await run();
 assert.equal((await observation('missing-source')).reason,'source_amount_missing');
 await event('unsigned',{},false);assert.equal((await run()).processed,0,'unsigned event never considered');
 await event('other-owner',{customer_id:'other-customer',virtual_account_id:'va-other'});await run();
 assert.equal((await observation('other-owner')).reason,'no_unused_approved_invoice_match');
 await event('wrong-customer',{customer_id:'not-customer'});await run();
 assert.equal((await observation('wrong-customer')).reason,'receiving_account_ambiguous');
 await invoice('INV-2');await invoice('INV-3');await event('ambiguous');await run();
 assert.equal((await observation('ambiguous')).reason,'multiple_matching_invoices');
 await event('wrong-sender',{source:{sender_name:'Buyer Holdings Ltd'}});await run();
 assert.equal((await observation('wrong-sender')).reason,'no_unused_approved_invoice_match');
 await db.query("update predeposit_invoices set status='rejected' where invoice_number in ('INV-2','INV-3')");
 const latest=await invoice('INV-4');
 await event('early-payment',{},true,'2026-09-20T00:30:00Z');await run();
 assert.equal((await observation('early-payment')).reason,'no_unused_approved_invoice_match','approval after payment is not pre-clearance');
 await event('expired-approval',{},true,'2026-09-28T00:00:00Z');
 await db.query("update bridge_webhook_events set received_at='2026-09-28T00:00:00Z' where event_id='expired-approval'");await run();
 assert.equal((await observation('expired-approval')).reason,'no_unused_approved_invoice_match');
 await event('unknown-time',{},true,'invalid');await run();
 assert.equal((await observation('unknown-time')).reason,'event_time_invalid');
 await event('fiat-disagreement',{receipt:{initial_amount:'200.00'}});await run();
 assert.equal((await observation('fiat-disagreement')).reason,'source_amount_conflict');
 await db.query("update bridge_virtual_accounts set user_id=business_user_id where bridge_virtual_account_id='va-eur'");
 await event('two-owners');await run();
 assert.equal((await observation('two-owners')).reason,'receiving_account_ambiguous');
 await db.query("update bridge_virtual_accounts set user_id=null where bridge_virtual_account_id='va-eur'");
 await db.exec(`
 create schema vault;create schema net;
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 create table net.calls(headers jsonb,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.calls values(headers,body);return 42;end;$$;
 create table predeposit_worker_requests(request_id bigint);
 insert into vault.decrypted_secrets values('borderpay_predeposit_worker_token','synthetic-worker-token-long-enough-1234567890');
 `);
 assert.equal((await db.query('select invoke_predeposit_worker() id')).rows[0].id,null,'processed queue does not dispatch');
 await event('wake-worker',{source:{sender_name:'Unmatched Buyer Ltd'}});
 assert.equal((await db.query('select invoke_predeposit_worker() id')).rows[0].id,42,'unprocessed deposit dispatches even with no queued invoices');
 await run();
 for(const amount of ['0','-1','1.001','1e2','9,000','90071992547409.92','not-money']){
  assert.equal((await db.query('select predeposit_money_minor($1) amount',[amount])).rows[0].amount,null);
 }
 assert.equal((await db.query("select predeposit_money_minor('8876.00') amount")).rows[0].amount,887600);
 await db.exec('set role authenticated');
 await assert.rejects(()=>db.query('select reconcile_predeposit_bridge_events()'),/permission denied/);
 await assert.rejects(()=>db.query('select * from predeposit_deposit_observations'),/permission denied/);
 await db.exec('reset role;set role anon');
 await assert.rejects(()=>db.query('select reconcile_predeposit_bridge_events()'),/permission denied/);
 await db.exec('reset role');
 await assert.rejects(()=>db.query("delete from predeposit_deposit_bindings"),/append-only/);
 console.log('PASS: disabled-by-default; signed webhook binding; source fiat precision; settlement dedup; owner/sender/amount matching; ambiguity; invoice reuse; append-only evidence; service-only authorization');
}finally{await db.close();}
