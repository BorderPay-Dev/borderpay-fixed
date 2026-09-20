import assert from "node:assert/strict";
import {extractCommercialEvidence} from "../supabase/functions/_shared/predeposit-extract.ts";
import {compareContractEvidence} from "../supabase/functions/_shared/predeposit-policy.ts";
const config={endpoint:"https://test.services.ai.azure.com",deployment:"gpt-5-806220",apiVersion:"2024-10-21",apiKey:"test-only",requestProfile:"gpt5" as const};
const values={seller_name:"Example Software Limited",buyer_name:"Example Buyer Limited",currency:"GBP",total_minor:125000,
 commercial_scope:"Enterprise software subscription September 2026 for 10 seats",seller_signature_present:true,buyer_signature_present:true,
 citations:{seller_name:"Seller: Example Software Limited",buyer_name:"Buyer: Example Buyer Limited",currency:"Currency: GBP",
 total_minor:"Total contract value: GBP 1250.00",commercial_scope:"Enterprise software subscription September 2026 for 10 seats",
 seller_signature_present:"Seller signature: Synthetic Test Signer",buyer_signature_present:"Buyer signature: Synthetic Buyer Signer"}};
function ocr(){
 const content=Object.values(values.citations).join("\n\n");
 return {status:"succeeded" as const,document_sha256:"a".repeat(64),content,pages:[{page_number:1,words:content.split(/\s+/).filter(Boolean).map(s=>({content:s.replace(/:$/,""),confidence:s==="seats"?0.805:0.995 as number|null}))}]};
}
const fetcher=async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(values)}}]});
Deno.test("split OCR label punctuation preserves contract extraction and actual confidence",async()=>{
 const result=await extractCommercialEvidence(ocr(),"contract",config,fetcher);
 assert.ok(result&&"seller_name" in result);assert.equal(result.total_minor,125000);assert.equal(result.confidence,0.805);
 assert.equal(result.execution_verified,false);
 assert.deepEqual(compareContractEvidence({} as any,result),["contract_extraction_unavailable"],"low-confidence evidence must remain in review");
});
Deno.test("citation normalization cannot admit fabricated quotes or missing confidence",async()=>{
 const document=ocr();document.content=document.content.replace("1250.00","9999.00");
 assert.equal(await extractCommercialEvidence(document,"contract",config,fetcher),null);
 const uncertain=ocr();uncertain.pages[0].words.find(w=>w.content==="1250.00")!.confidence=null;
 assert.equal(await extractCommercialEvidence(uncertain,"contract",config,fetcher),null);
});
