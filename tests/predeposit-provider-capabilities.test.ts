import assert from "node:assert/strict";
import {assertCollectionEntitlement,assertNoComplianceBypass,type CollectionEntitlement} from "../supabase/functions/_shared/predeposit-provider-capabilities.ts";
const e:CollectionEntitlement={provider:"bridge",environment:"sandbox",customer_id:"customer",account_id:"account",currency:"GBP",third_party_b2b:true,provider_approval_reference:"test-approval",enabled:true,expires_at:null};
Deno.test("provider permissions bind environment, merchant, account and currency",()=>{
 assert.doesNotThrow(()=>assertCollectionEntitlement(e,e));
 for(const field of ["provider","environment","customer_id","account_id","currency"]){assert.throws(()=>assertCollectionEntitlement(e,{...e,[field]:"different"}));}
});
Deno.test("first-party accounts and expired collection permissions cannot fund buyer invoices",()=>{
 assert.throws(()=>assertCollectionEntitlement({...e,provider:"borderless",third_party_b2b:false},{...e,provider:"borderless"}),/Third-party/);
 assert.throws(()=>assertCollectionEntitlement({...e,expires_at:"2020-01-01T00:00:00Z"},e),/expired/);
});
Deno.test("provider switching does not bypass a pending hold",()=>{
 for(const provider_status of ["paused","frozen","rejected","under_review"]){assert.throws(()=>assertNoComplianceBypass({borderpay_status:"active",provider_status},{approved:true,active:true,compliance_case_resolved:true}));}
 assert.throws(()=>assertNoComplianceBypass({borderpay_status:"active",provider_status:"active"},{approved:true,active:true,compliance_case_resolved:false}));
});