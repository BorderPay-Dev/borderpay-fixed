import assert from "node:assert/strict";
import {runPredepositSelfTest} from "../supabase/functions/_shared/predeposit-self-test.ts";
import {evaluateInvoice,assessedDigest} from "../supabase/functions/_shared/predeposit-policy.ts";
Deno.test("synthetic worker probe uses only credential RPC and never writes production records",async()=>{
 const calls:string[]=[];
 const db={rpc:async(name:string)=>{calls.push(name);assert.equal(name,"predeposit_ocr_config");return {data:{provider:"content_understanding",endpoint:"https://test.services.ai.azure.com",apiKey:"test"},error:null};}};
 const report=await runPredepositSelfTest(db,async(fake,row)=>{
  const context=row.review_context;
  const assets=await fake.from("predeposit_assets").select("*").eq("owner_user_id",row.owner_user_id);
  context.verifiedEvidenceHashes=assets.data.map((a:any)=>a.sha256);
  const ai={status:"passed" as const,findings:[],provider_request_id:null,model:"test",prompt_version:"test",payload_sha256:await assessedDigest(row.payload,context),physical_goods_detected:false};
  return {pending:false,context,assessment:{...evaluateInvoice(row.payload,context,ai),payload_sha256:row.payload_sha256,assessed_sha256:ai.payload_sha256,review_context:context,config_sha256:row.review_context.config_sha256,deterministic_status:"ready_for_ai"}};
 });
 assert.equal(report.production_records_written,0);assert.equal(report.provider_accounts_called,0);
 assert.equal(report.all_expected,true);assert.equal(report.results.length,5);
 assert.deepEqual(calls,["predeposit_ocr_config"]);
 assert.ok(report.results.every(r=>r.bank_details_locked));
 assert.equal(JSON.stringify(report).includes("apiKey"),false);
});
Deno.test("synthetic probe refuses missing OCR configuration",async()=>{
 await assert.rejects(()=>runPredepositSelfTest({rpc:async()=>({data:null,error:null})}),/configuration unavailable/);
});
