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
const tenant='10000000-0000-4000-8000-000000000001',org='20000000-0000-4000-8000-000000000001',app='30000000-0000-4000-8000-000000000001',review='40000000-0000-4000-8000-000000000001',actor='50000000-0000-4000-8000-000000000001';
await db.query("insert into api_tenants values($1,'sandbox',true)",[tenant]);
await db.query("insert into partner_organizations values($1,$2,'approved')",[org,tenant]);
await db.query("insert into partner_applications values($1,$2,1,'approved',array['api'],$3,'{\"intended_use\":\"Business payments\"}',now())",[app,org,{technical_contact_email:'tech@example.test',compliance_contact_email:'compliance@example.test',security_contact_email:'security@example.test'}]);
const sync=async()=>(await db.query("select reconcile_partner_sandbox_approval($1,'admin-key-issuance') x",[tenant])).rows[0].x;
await assert.rejects(sync());
await db.query("insert into partner_application_reviews values($1,$2,$3,'approved',now())",[review,app,actor]);
await db.query("update api_tenants set default_mode='production'");await assert.rejects(sync());
await db.query("update api_tenants set default_mode='sandbox',is_active=false");await assert.rejects(sync());
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
console.log('PASS: recorded approval reconciliation, sandbox-only, active tenant, exact product, contact checks, idempotency, no suspension override, service-only access');
}catch(e){console.error(e.message);if(e.where)console.error(e.where);process.exitCode=1}finally{await db.close()}
