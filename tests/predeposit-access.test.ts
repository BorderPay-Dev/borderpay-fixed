import assert from "node:assert/strict";
import {redactBankCoordinates,requiresInvoiceInstructions} from "../supabase/functions/_shared/predeposit-access.ts";
Deno.test("legacy responses and API replays cannot expose coordinates when gated",()=>{
 const original={success:true,data:{currency:"EUR",virtual_account_id:"va-1",account_details:{iban:"secret"},iban:"secret",nested:{accountLetterUrl:"https://bank/letter",routing_number:"secret"}},other:[{account_number:"secret"}]};
 const result:any=redactBankCoordinates(original);assert.equal(result.data.currency,"EUR");assert.equal(result.data.virtual_account_id,"va-1");
 assert.equal(JSON.stringify(result).includes("secret"),false);assert.equal(result.data.nested.accountLetterUrl,null);assert.equal(original.data.iban,"secret");
});
Deno.test("instruction policy requires an explicit boolean server answer",async()=>{
 assert.equal(await requiresInvoiceInstructions({rpc:async()=>({data:false,error:null})},"owner"),false);
 assert.equal(await requiresInvoiceInstructions({rpc:async()=>({data:true,error:null})},"owner"),true);
 for(const result of [{data:null,error:null},{data:false,error:{message:"failed"}}])await assert.rejects(()=>requiresInvoiceInstructions({rpc:async()=>result},"owner"));
});