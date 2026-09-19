import assert from "node:assert/strict";
import {startDocumentOcr,pollDocumentOcr,supportedEvidenceBytes} from "../supabase/functions/_shared/predeposit-document-intelligence.ts";
const config={endpoint:"https://example.cognitiveservices.azure.com",apiKey:"test-only"};
const bytes=new TextEncoder().encode("%PDF-1.7 test fixture");
Deno.test("OCR validates file type and binds the submitted bytes",async()=>{
 assert.equal(supportedEvidenceBytes(bytes,"image/png"),false);
 const job=await startDocumentOcr(bytes,"application/pdf",config,async(url,init)=>{
  assert.match(String(url),/prebuilt-layout:analyze/);assert.equal(init?.redirect,"error");
  return new Response(null,{status:202,headers:{"operation-location":"https://example.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-layout/analyzeResults/abc?api-version=2024-11-30"}});
 });
 assert.equal(job.status,"pending");if(job.status!=="pending")throw Error("missing job");
 assert.match(job.document_sha256,/^[a-f0-9]{64}$/);
 const result=await pollDocumentOcr(job,config,async()=>new Response(JSON.stringify({status:"succeeded",analyzeResult:{content:"Order ABC",pages:[{pageNumber:1,words:[{content:"ABC",confidence:0.8},{content:"missing"}]}]}})));
 assert.equal(result.status,"succeeded");if(result.status!=="succeeded")throw Error("missing result");
 assert.equal(result.pages[0].words[0].confidence,0.8);assert.equal(result.pages[0].words[1].confidence,null);
 assert.equal(result.document_sha256,job.document_sha256);
});
Deno.test("OCR never follows an untrusted operation endpoint or returns success for pending",async()=>{
 const bad=await startDocumentOcr(bytes,"application/pdf",config,async()=>new Response(null,{status:202,headers:{"operation-location":"https://attacker.example/documentintelligence/documentModels/prebuilt-layout/analyzeResults/abc"}}));
 assert.equal(bad.status,"failed");
 let called=false;
 const result=await pollDocumentOcr({status:"pending",document_sha256:"a".repeat(64),operation_url:"https://attacker.example/steal"},config,async()=>{called=true;throw Error("must not fetch");});
 assert.equal(result.status,"failed");assert.equal(called,false);
 const pending=await pollDocumentOcr({status:"pending",document_sha256:"a".repeat(64),operation_url:"https://example.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-layout/analyzeResults/a"},config,async()=>new Response(JSON.stringify({status:"running"})));
 assert.equal(pending.status,"pending");
});
