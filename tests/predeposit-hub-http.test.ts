import assert from "node:assert/strict";
const base="https://predeposit-http-test.invalid";
const owner="11111111-1111-4111-8111-111111111111";
Deno.env.set("SUPABASE_URL",base);Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-only-not-a-credential");
let handler:(req:Request)=>Promise<Response>;
const serve=Deno.serve;Deno.serve=((fn:typeof handler)=>{handler=fn;return {};}) as typeof Deno.serve;
try{await import("../supabase/functions/predeposit-hub/index.ts");}finally{Deno.serve=serve;}
Deno.test("invoice endpoint authenticates users, honors disabled rollout and denies merchant operator actions",async()=>{
 const original=globalThis.fetch;let role="business",enabled=false;const calls:string[]=[];
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url);calls.push(url.pathname);
  assert.equal(url.origin,base,"No provider or OCR network call is allowed in these rejected requests");
  if(url.pathname==="/auth/v1/user")return Response.json({id:owner});
  if(url.pathname.endsWith("/admin_users"))return Response.json([]);
  if(url.pathname.endsWith("/user_profiles"))return Response.json([{account_type:role}]);
  if(url.pathname.endsWith("/predeposit_policy"))return Response.json({singleton:true,mode:"disabled",scope:"business",config:{hub_enabled:enabled}});
  throw Error("Unexpected request: "+url.pathname);
 };
 const req=(body:unknown,auth=true)=>new Request(base+"/functions/v1/predeposit-hub",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer test-session"}:{})},body:JSON.stringify(body)});
 try{
  assert.equal((await handler(req({action:"bootstrap"},false))).status,401);
  assert.equal(calls.length,0);
  const bootstrap=await handler(req({action:"bootstrap"}));assert.equal(bootstrap.status,200);
  assert.deepEqual((await bootstrap.json()).data,{enabled:false,accounts:[],templates:[]});
  assert.equal((await handler(req({action:"save_draft",payload:{}}))).status,503);
  enabled=true;
  assert.equal((await handler(req({action:"admin_list"}))).status,403);
  assert.equal((await handler(req({action:"admin_save_template",approved:true}))).status,403);
  role="individual";assert.equal((await handler(req({action:"bootstrap"}))).status,403);
  assert.equal((await handler(new Request(base,{method:"GET"}))).status,405);
 }finally{globalThis.fetch=original;}
});

Deno.test("invoice copies need billing data but no approval, contract or receiving account",async()=>{
 const {invoiceCopy}=await import("../supabase/functions/_shared/predeposit-invoice-copy.ts");
 const draft={currency:"EUR",receiving_account_id:"",buyer:{legal_name:"Buyer Ltd",type:"company",address:"10 Example Road",country:"FR",tax_id:""},
 remitter:{legal_name:"",type:"company",relationship:""},category:"digital_services",order_source:"direct_b2b",order_platform:"",order_reference:"",tracking_numbers:[],
 items:[{description:"Enterprise software licence September 2026",quantity:1,unit_amount_minor:12500,deliverable_reference:"LIC-1"}],
 source_of_funds:"private funding details",fund_utilization:"private use of funds",discovery_channel:"",cross_border_justification:"",commercial_end_use:"",
 contract_path:"generated",agreement_version:"",signature_consent:false,document_ids:[],instalments:{expected_count:1,commercial_reason:""}};
 const merchant={legal_name:"Seller Ltd",incorporation_country:"GB"};
 const copy=invoiceCopy(draft,merchant,"copy-1",1);
 assert.equal(copy.currency,"EUR");assert.equal(copy.items[0].unit_amount_minor,12500);assert.deepEqual(copy.documents,[]);
 assert.equal(copy.agreement.signature_consent,false);
 assert.throws(()=>invoiceCopy({...draft,buyer:{...draft.buyer,legal_name:""}},merchant,"copy",1));
 assert.throws(()=>invoiceCopy({...draft,currency:"GBP",buyer:{...draft.buyer,type:"individual"}},merchant,"copy",1),/GBP/);
 assert.throws(()=>invoiceCopy({...draft,items:[{...draft.items[0],description:""}]},merchant,"copy",1));
});
Deno.test("invoice-copy download enforces owner and draft version without contacting the provider",async()=>{
 const original=globalThis.fetch;let foreign=false;
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url);
  assert.equal(url.origin,base,"Invoice-only downloads must not call a payment provider");
  if(url.pathname==="/auth/v1/user")return Response.json({id:owner});
  if(url.pathname.endsWith("/admin_users"))return Response.json([]);
  if(url.pathname.endsWith("/user_profiles"))return Response.json([{account_type:"business"}]);
  if(url.pathname.endsWith("/predeposit_policy"))return Response.json({config:{hub_enabled:true}});
  if(url.pathname.endsWith("/predeposit_drafts")||url.pathname.endsWith("/predeposit_invoices")){
   assert.equal(url.searchParams.get("owner_user_id"),"eq."+owner);
   return foreign?Response.json({message:"No owned record"},{status:406}):Response.json({version:2});
  }
  throw Error("Unexpected request: "+url.pathname);
 };
 const request=(body:unknown)=>new Request(base,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer test-session"},body:JSON.stringify(body)});
 try{
  const stale=await handler(request({action:"download_invoice",draft_id:owner,version:1}));
  assert.equal(stale.status,400);assert.match((await stale.json()).error,/Draft changed/);
  foreign=true;
  for(const ref of [{draft_id:owner,version:2},{invoice_id:owner}]){
   const response=await handler(request({action:"download_invoice",...ref}));
   assert.equal(response.status,400);assert.equal((await response.json()).success,false);
  }
 }finally{globalThis.fetch=original;}
});

Deno.test("observation invoices include only the current owned account; enforcement and GBP remain guarded",async()=>{
 const {generateObservedInvoiceInstructions}=await import("../supabase/functions/_shared/predeposit-payment-instructions.ts");
 const inv:any={id:"invoice",receiving_account_id:"va",currency:"GBP",buyer:{type:"company"},remitter:{type:"company"},items:[{quantity:1,unit_amount_minor:12599}]};
 const account={id:"va",owner_user_id:owner,currency:"GBP",status:"active",beneficiary_name:"Seller Ltd",bank_name:"Example Bank",account_number:"12345678",sort_code:"12-34-56",required_payment_reference:"KEEP-REFERENCE"};
 const result=generateObservedInvoiceInstructions(owner,inv,account,"observe");
 assert.equal(result.amount,"125.99");assert.equal(result.sort_code,"12-34-56");assert.equal(result.required_payment_reference,"KEEP-REFERENCE");
 for(const mode of ["enforce","disabled",undefined])assert.throws(()=>generateObservedInvoiceInstructions(owner,inv,account,mode),/approval/);
 for(const patch of [{owner_user_id:"other"},{status:"inactive"},{id:"other"},{currency:"EUR"}])assert.throws(()=>generateObservedInvoiceInstructions(owner,inv,{...account,...patch},"observe"),/unavailable/);
 assert.throws(()=>generateObservedInvoiceInstructions(owner,{...inv,buyer:{type:"individual"}},account,"observe"),/GBP/);
 assert.throws(()=>generateObservedInvoiceInstructions(owner,inv,{...account,sort_code:""},"observe"),/sort code/);
});
