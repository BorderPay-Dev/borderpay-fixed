import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');const db=new PGlite();
try{
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table api_tenants(id uuid primary key,default_mode text,is_active boolean);
create table partner_organizations(id uuid primary key,approved_tenant_id uuid,status text);
create table partner_applications(id uuid primary key,organization_id uuid,version int,status text,requested_products text[],technical_details jsonb,operating_details jsonb,created_at timestamptz);
create table partner_application_reviews(id uuid,application_id uuid,reviewer_user_id uuid,decision text,created_at timestamptz);
create table api_partner_approvals(tenant_id uuid primary key,status text,partner_type text,approved_products text[],approved_use_case text,technical_contact_email text,compliance_contact_email text,incident_contact_email text,compliance_approval_reference text,engineering_approval_reference text,compliance_approved_by text,engineering_approved_by text,recorded_by text,approved_at timestamptz);
create table partner_portal_audit_log(organization_id uuid,application_id uuid,event_type text,metadata jsonb);
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260919210000_partner_key_approval_reconciliation.sql',import.meta.url),'utf8'));

await db.exec(`
alter table api_tenants alter column id set default gen_random_uuid();
alter table api_tenants add column tenant_name text,add column beta_access_enabled boolean,add column metadata jsonb;
alter table partner_organizations add column legal_name text,add column primary_email text,add column updated_at timestamptz;
alter table partner_applications add column entity_details jsonb,add column decision_summary text,add column decided_at timestamptz,add column updated_at timestamptz;
alter table partner_application_reviews alter column id set default gen_random_uuid();
alter table partner_application_reviews alter column created_at set default now();
alter table partner_application_reviews add column notes text;
alter table partner_portal_audit_log add column actor_user_id uuid;
create table admin_users(user_id uuid,role text);
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260919220000_all_partner_approval_sync.sql',import.meta.url),'utf8'));
const tenant='10000000-0000-4000-8000-000000000001',org='20000000-0000-4000-8000-000000000001',app='30000000-0000-4000-8000-000000000001',review='40000000-0000-4000-8000-000000000001',actor='50000000-0000-4000-8000-000000000001';
await db.query("insert into api_tenants(id,default_mode,is_active) values($1,'sandbox',true)",[tenant]);
await db.query("insert into partner_organizations(id,approved_tenant_id,status) values($1,$2,'approved')",[org,tenant]);
await db.query("insert into partner_applications(id,organization_id,version,status,requested_products,technical_details,operating_details,created_at) values($1,$2,1,'approved',array['api'],$3,'{\"intended_use\":\"Business payments\"}',now())",[app,org,{technical_contact_email:'tech@example.test',compliance_contact_email:'compliance@example.test',security_contact_email:'security@example.test'}]);
const sync=async()=>(await db.query("select reconcile_partner_sandbox_approval($1,'admin-key-issuance') x",[tenant])).rows[0].x;
await assert.rejects(sync());
await db.query("insert into partner_application_reviews(id,application_id,reviewer_user_id,decision,created_at) values($1,$2,$3,'approved',now())",[review,app,actor]);
await db.query("update api_tenants set default_mode='production'");await assert.rejects(sync());
await db.query("update api_tenants set default_mode='sandbox',is_active=false"); const inactiveApproval=await sync();assert.equal(inactiveApproval.status,'approved');assert.equal((await db.query('select is_active from api_tenants')).rows[0].is_active,false);await db.query('delete from api_partner_approvals');await db.query('delete from partner_portal_audit_log');
await db.query("update api_tenants set is_active=true");
await db.query("update partner_organizations set status='suspended'");await assert.rejects(sync());
await db.query("update partner_organizations set status='approved'");
await db.query("update partner_applications set status='more_information'");await assert.rejects(sync());
await db.query("update partner_applications set status='approved'");
const approved=await sync();assert.equal(approved.status,'approved');assert.deepEqual(approved.approved_products,['api']);assert.equal(approved.compliance_approval_reference,'partner-review:'+review);assert.equal(approved.compliance_approved_by,actor);
assert.deepEqual(await sync(),approved);
assert.equal((await db.query('select count(*)::int n from partner_portal_audit_log')).rows[0].n,1);
await db.query("update api_partner_approvals set status='suspended'");assert.equal((await sync()).status,'suspended');
await db.query("delete from api_partner_approvals");await db.query("update partner_applications set requested_products=array['white_label']");assert.deepEqual((await sync()).approved_products,['white_label']);
await db.query("delete from api_partner_approvals");await db.query("update partner_applications set technical_details='{}'");await assert.rejects(sync());
const access=(await db.query("select has_function_privilege('authenticated','reconcile_partner_sandbox_approval(uuid,text)','EXECUTE') a,has_function_privilege('service_role','reconcile_partner_sandbox_approval(uuid,text)','EXECUTE') s")).rows[0];assert.equal(access.a,false);assert.equal(access.s,true);

await db.query('insert into admin_users values($1,\'ADMIN_SUPER\')',[actor]);
const contacts={technical_contact_email:'tech@example.test',compliance_contact_email:'compliance@example.test',security_contact_email:'security@example.test'};
const decide=async(id,status='approved',who=actor)=>(await db.query("select record_partner_application_decision($1,$2,$3,'Reviewed and confirmed') x",[id,who,status])).rows[0].x;
for(const product of ['api','white_label']){
 const o=crypto.randomUUID(),a=crypto.randomUUID();
 await db.query("insert into partner_organizations(id,status,legal_name,primary_email) values($1,'under_review','Future Partner','partner@example.test')",[o]);
 await db.query("insert into partner_applications(id,organization_id,version,status,requested_products,technical_details,operating_details,created_at) values($1,$2,1,'under_review',$3,$4,'{\"intended_use\":\"Business payments\"}',now())",[a,o,[product],contacts]);
 await assert.rejects(decide(a,'approved',crypto.randomUUID()));
 const result=await decide(a);
 const row=(await db.query('select t.is_active,t.default_mode,t.beta_access_enabled,p.status,p.approved_products from api_tenants t join api_partner_approvals p on p.tenant_id=t.id where t.id=$1',[result.tenant_id])).rows[0];
 assert.equal(row.is_active,false);assert.equal(row.beta_access_enabled,false);assert.equal(row.default_mode,'sandbox');assert.equal(row.status,'approved');assert.deepEqual(row.approved_products,[product]);
 const repeat=await decide(a);assert.equal(repeat.reused,true);assert.equal(repeat.review_id,result.review_id);
 assert.equal((await db.query("select count(*)::int n from partner_portal_audit_log where organization_id=$1 and event_type='sandbox_product_approval_reconciled'",[o])).rows[0].n,1);
 await db.query("update api_partner_approvals set status='suspended' where tenant_id=$1",[result.tenant_id]);
 await decide(a);assert.equal((await db.query('select status from api_partner_approvals where tenant_id=$1',[result.tenant_id])).rows[0].status,'suspended');
}
// Backfill repairs existing eligible approvals and is safe to repeat.
await db.query('update partner_applications set technical_details=$1 where id=$2',[contacts,app]);
await db.exec(await readFile(new URL('../supabase/migrations/20260919220000_all_partner_approval_sync.sql',import.meta.url),'utf8'));
assert.deepEqual((await db.query('select approved_products from api_partner_approvals where tenant_id=$1',[tenant])).rows[0].approved_products,['white_label']);
const beforeBackfill=(await db.query('select count(*)::int n from partner_portal_audit_log')).rows[0].n;
await db.exec(await readFile(new URL('../supabase/migrations/20260919220000_all_partner_approval_sync.sql',import.meta.url),'utf8'));
assert.equal((await db.query('select count(*)::int n from partner_portal_audit_log')).rows[0].n,beforeBackfill);
// Product provisioning failure rolls back the approval and review atomically.
const badOrg=crypto.randomUUID(),badApp=crypto.randomUUID();
await db.query("insert into partner_organizations(id,status) values($1,'under_review')",[badOrg]);
await db.query("insert into partner_applications(id,organization_id,version,status,requested_products,technical_details,operating_details,created_at) values($1,$2,1,'under_review',array['api'],'{}','{}',now())",[badApp,badOrg]);
await assert.rejects(decide(badApp));
assert.equal((await db.query('select status from partner_applications where id=$1',[badApp])).rows[0].status,'under_review');
assert.equal((await db.query('select count(*)::int n from partner_application_reviews where application_id=$1',[badApp])).rows[0].n,0);
await decide(badApp,'more_information');
assert.equal((await db.query('select approved_tenant_id from partner_organizations where id=$1',[badOrg])).rows[0].approved_tenant_id,null);

console.log('PASS: recorded approval reconciliation, sandbox-only, inactive preserved, future approvals atomic, exact product, contact checks, idempotency, no suspension override, service-only access');
}catch(e){console.error(e.message);if(e.where)console.error(e.where);process.exitCode=1}finally{await db.close()}
