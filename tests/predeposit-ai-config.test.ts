import assert from "node:assert/strict";
import {loadInvoiceAiConfig} from "../supabase/functions/_shared/predeposit-ai-config.ts";
Deno.test("invoice AI uses dedicated server configuration and ignores global model settings",async()=>{
 Deno.env.set("AZURE_OPENAI_ENDPOINT","https://unrelated.azure-api.net");
 Deno.env.set("AZURE_OPENAI_DEPLOYMENT_NAME","unrelated-model");
 try{
  const missing=await loadInvoiceAiConfig({rpc:async()=>({data:{},error:null})});
  assert.equal(missing.endpoint,"");assert.equal(missing.deployment,"");assert.equal(missing.apiKey,"");
  const selected=await loadInvoiceAiConfig({rpc:async(name:string)=>{assert.equal(name,"predeposit_ai_config");return {data:{endpoint:" https://test.openai.azure.com/ ",apiKey:" test-only ",deployment:" invoice-gpt4o "},error:null};}});
  assert.deepEqual(selected,{endpoint:"https://test.openai.azure.com/",apiKey:"test-only",deployment:"invoice-gpt4o",apiVersion:"2024-10-21"});
  await assert.rejects(()=>loadInvoiceAiConfig({rpc:async()=>({error:{message:"denied"}})}),/configuration unavailable/);
 }finally{Deno.env.delete("AZURE_OPENAI_ENDPOINT");Deno.env.delete("AZURE_OPENAI_DEPLOYMENT_NAME");}
});
