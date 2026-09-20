import assert from "node:assert/strict";
import {startContentUnderstandingOcr,pollContentUnderstandingOcr} from "../supabase/functions/_shared/predeposit-content-understanding.ts";
import {startEvidenceOcr,pollEvidenceOcr,loadEvidenceOcrConfig} from "../supabase/functions/_shared/predeposit-evidence-ocr.ts";
import {sha256} from "../supabase/functions/_shared/predeposit-policy.ts";
const config={provider:"content_understanding" as const,endpoint:"https://test.services.ai.azure.com",apiKey:"test-only"};
const bytes=new TextEncoder().encode("%PDF-1.7 fixture");
const operation=config.endpoint+"/contentunderstanding/analyzerResults/test-job?api-version=2025-11-01";
const pending={status:"pending" as const,operation_url:operation,document_sha256:"a".repeat(64),provider:"content_understanding" as const};
const completed=()=>({status:"Succeeded",result:{analyzerId:"prebuilt-layout",apiVersion:"2025-11-01",contents:[
 {kind:"document",markdown:"Invoice 123 EUR",pages:[{pageNumber:1,words:[{content:"Invoice",confidence:0.98},{content:"123",confidence:0.91},{content:"EUR"}]}]}
]}});
Deno.test("Content Understanding submits exact private bytes with GA layout and geography processing",async()=>{
 let count=0;
 const job=await startEvidenceOcr(bytes,"application/pdf",config,async(url,init)=>{
  count++;const u=new URL(String(url));assert.equal(u.pathname,"/contentunderstanding/analyzers/prebuilt-layout:analyze");
  assert.equal(u.searchParams.get("api-version"),"2025-11-01");assert.equal(u.searchParams.get("processingLocation"),"geography");
  assert.equal(init?.redirect,"error");assert.equal(new Headers(init?.headers).get("Ocp-Apim-Subscription-Key"),"test-only");
  const body=JSON.parse(String(init?.body));assert.equal(body.inputs.length,1);assert.equal(body.inputs[0].mimeType,"application/pdf");
  assert.deepEqual(Uint8Array.from(atob(body.inputs[0].data),c=>c.charCodeAt(0)),bytes);assert.equal(body.inputs[0].url,undefined);
  return new Response(null,{status:202,headers:{"Operation-Location":operation}});
 });
 assert.equal(count,1);assert.equal(job.status,"pending");assert.equal(job.provider,"content_understanding");
 if(job.status!=="pending")throw Error("No job");assert.equal(job.document_sha256,await sha256(bytes));
 const result=await pollEvidenceOcr(job,config,async()=>Response.json(completed()));
 assert.equal(result.status,"succeeded");if(result.status!=="succeeded")throw Error("No OCR");
 assert.equal(result.document_sha256,job.document_sha256);assert.equal(result.content,"Invoice 123 EUR");
 assert.equal(result.pages[0].words[1].confidence,0.91);assert.equal(result.pages[0].words[2].confidence,null);
});
Deno.test("Content Understanding refuses invalid bytes, project endpoints and credential redirects",async()=>{
 let calls=0;const noFetch=async()=>{calls++;throw Error("Must not send credentials");};
 for(const endpoint of ["http://test.services.ai.azure.com","https://test.services.ai.azure.com.evil.test","https://test.services.ai.azure.com/api/projects/test","https://user:pass@test.services.ai.azure.com","https://test.services.ai.azure.com/?key=bad"]){
  assert.equal((await startContentUnderstandingOcr(bytes,"application/pdf",{...config,endpoint},noFetch)).status,"failed");
 }
 assert.equal((await startContentUnderstandingOcr(bytes,"image/png",config,noFetch)).status,"failed");
 for(const operation_url of ["https://evil.test/steal",config.endpoint+"/other/path?api-version=2025-11-01",operation.replace("2025-11-01","2026-06-01-preview")]){
  assert.equal((await pollContentUnderstandingOcr({...pending,operation_url},config,noFetch)).status,"failed");
 }
 assert.equal((await pollEvidenceOcr({...pending,provider:"document_intelligence"},config,noFetch)).status,"failed");
 assert.equal(calls,0);
 const redirected=await startContentUnderstandingOcr(bytes,"application/pdf",config,async()=>new Response(null,{status:202,headers:{"Operation-Location":"https://evil.test/steal"}}));
 assert.equal(redirected.status,"failed");
});
Deno.test("Content Understanding pending, failed and malformed responses never become approved evidence",async()=>{
 for(const status of ["Running","NotStarted"])assert.equal((await pollEvidenceOcr(pending,config,async()=>Response.json({status}))).status,"pending");
 const invalid:any[]=[{status:"Failed"}, {...completed(),status:"Canceled"}];
 const missingWords=completed();delete (missingWords.result.contents[0].pages[0] as any).words;invalid.push(missingWords);
 const wrongKind=completed();wrongKind.result.contents[0].kind="audioVisual";invalid.push(wrongKind);
 const wrongAnalyzer=completed();wrongAnalyzer.result.analyzerId="other";invalid.push(wrongAnalyzer);
 const oversized=completed();oversized.result.contents[0].markdown="x".repeat(200001);invalid.push(oversized);
 for(const result of invalid)assert.equal((await pollEvidenceOcr(pending,config,async()=>Response.json(result))).status,"failed");
 for(const status of [401,429,500])assert.equal((await pollEvidenceOcr(pending,config,async()=>new Response(null,{status}))).status,"failed");
});
Deno.test("OCR configuration selects explicit Vault provider and never falls back after configuration failure",async()=>{
 const db={rpc:async(name:string)=>{assert.equal(name,"predeposit_ocr_config");return {data:config,error:null};}};
 assert.deepEqual(await loadEvidenceOcrConfig(db),config);
 await assert.rejects(()=>loadEvidenceOcrConfig({rpc:async()=>({error:{message:"unavailable"}})}),/configuration unavailable/);
 await assert.rejects(()=>loadEvidenceOcrConfig({rpc:async()=>({data:{provider:"unknown"}})}),/Invalid OCR provider/);
 const legacy=await loadEvidenceOcrConfig({rpc:async()=>({data:{endpoint:"https://old.cognitiveservices.azure.com",apiKey:"legacy-test"}})});
 assert.equal(legacy.provider,"document_intelligence");
});
