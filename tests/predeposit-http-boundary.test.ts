import assert from "node:assert/strict";
import {withInvoiceInstructionBoundary} from "../supabase/functions/_shared/predeposit-http-boundary.ts";
const request=()=>new Request("https://example.invalid/va",{method:"POST",body:JSON.stringify({currency:"EUR"})});
Deno.test("VA wrapper preserves disabled payload and exact request before provider execution",async()=>{
 const payload={success:true,data:{iban:"PRIVATE",currency:"EUR",destination:{address:"CRYPTO"}}};let calls=0;
 const result=await withInvoiceInstructionBoundary(request(),{
  authenticate:async()=>"owner",checkAccess:async()=>null,required:async()=>false,
  handle:async req=>{calls++;assert.deepEqual(await req.json(),{currency:"EUR"});return Response.json(payload,{status:201});}
 });
 assert.equal(result.status,201);assert.deepEqual(await result.json(),payload);assert.equal(calls,1);
 assert.equal(result.headers.get("Cache-Control"),"no-store");
});
Deno.test("VA wrapper removes coordinates from every response when required, including a mid-request activation",async()=>{
 for(const policy of [[true,true],[false,true],[true,false]]){
  let i=0;
  const response=await withInvoiceInstructionBoundary(request(),{authenticate:async()=>"owner",checkAccess:async()=>null,required:async()=>policy[i++],
   handle:async()=>Response.json({data:{iban:"PRIVATE",account_details:{account_number:"PRIVATE"},account_letter_url:"PRIVATE",destination:{address:"CRYPTO"},currency:"EUR"}},{status:202,headers:{ETag:"cached"}})});
  assert.equal(response.status,202);const body=await response.json();assert.equal(JSON.stringify(body).includes("PRIVATE"),false);
  assert.equal(body.data.destination.address,"CRYPTO");assert.equal(response.headers.get("ETag"),null);
 }
});
Deno.test("VA wrapper blocks unauthorized, restricted and unavailable-policy requests before provider side effects",async()=>{
 let calls=0;const handle=async()=>{calls++;return Response.json({});};
 const common={authenticate:async()=>"owner",checkAccess:async()=>null,required:async()=>false,handle};
 assert.equal((await withInvoiceInstructionBoundary(request(),{...common,authenticate:async()=>null})).status,401);
 assert.equal((await withInvoiceInstructionBoundary(request(),{...common,checkAccess:async()=>new Response("blocked",{status:423})})).status,423);
 assert.equal((await withInvoiceInstructionBoundary(request(),{...common,required:async()=>{throw Error("policy offline");}})).status,503);
 assert.equal(calls,0);
});
Deno.test("VA wrapper never returns raw bodies on policy or JSON failure after provider completion",async()=>{
 const common={authenticate:async()=>"owner",checkAccess:async()=>null,handle:async()=>new Response("PRIVATE")};
 let count=0;
 const error=await withInvoiceInstructionBoundary(request(),{...common,required:async()=>{if(count++)throw Error();return false;}});
 assert.equal(error.status,503);assert.equal((await error.text()).includes("PRIVATE"),false);
 const nonJson=await withInvoiceInstructionBoundary(request(),{...common,required:async()=>true});
 assert.equal(nonJson.status,503);assert.equal((await nonJson.text()).includes("PRIVATE"),false);
});
