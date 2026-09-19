import assert from "node:assert/strict";
import { evaluateInvoice, invoiceTotalMinor, assessedDigest, compareOrderEvidence, type Invoice, type ReviewContext, type OrderEvidence } from "../supabase/functions/_shared/predeposit-policy.ts";
import { screenInvoice, assessWithAi } from "../supabase/functions/_shared/predeposit-azure.ts";
import {generateBankPaymentInstructions} from "../supabase/functions/_shared/predeposit-payment-instructions.ts";
const h=(c:string)=>c.repeat(64);
function fixture():{invoice:Invoice;context:ReviewContext}{
 return {invoice:{
 id:"invoice-1",revision:1,currency:"GBP",receiving_account_id:"va-gbp-1",
 merchant:{legal_name:"Example Merchant Ltd",incorporation_country:"GB"},
 buyer:{legal_name:"Example Buyer Ltd",type:"company",address:"10 Example Street, London",country:"GB",tax_id:"GB123456789"},
 remitter:{legal_name:"Example Buyer Ltd",type:"company",relationship:"Corporate buyer paying its contracted subscription invoice."},
 category:"digital_services",order_source:"direct_b2b",order_platform:"",order_reference:"",tracking_numbers:[],
 items:[{description:"Enterprise SaaS licence for September 2026, 20 seats",quantity:1,unit_amount_minor:12500,deliverable_reference:"LIC-804"}],
 source_of_funds:"Buyer's operating revenue from its declared commercial activities.",
 fund_utilization:"Settlement for the September 2026 enterprise software subscription.",
 discovery_channel:"",cross_border_justification:"",commercial_end_use:"",
 agreement:{version:"counsel-approved-v1",terms_sha256:h("a"),signature_sha256:h("b"),signed_by:"Example Director",signed_at:"2026-09-19T09:00:00Z"},
 documents:[{id:"agreement-1",kind:"signed_agreement",sha256:h("c")}],
 instalments:{expected_count:1,commercial_reason:""}
 },context:{
 merchantUserId:"merchant-1",receivingAccount:{id:"va-gbp-1",owner_user_id:"merchant-1",currency:"GBP",status:"active"},
 verifiedMerchant:{legal_name:"Example Merchant Ltd",incorporation_country:"GB",active:true,approved:true},
 jurisdictionPolicy:{version:"approved-test-policy",known_countries:["GB","FR","LV"],review_countries:[]},
 approvedAgreementVersions:["counsel-approved-v1"],
 history:{available:true,buyer_invoice_count_30d:0,same_currency_total_minor_30d:0},
 structuring:{max_invoices_30d:4,aggregate_review_minor:{USD:1000000,EUR:1000000,GBP:1000000}},
 verifiedEvidenceHashes:[h("c")],orderEvidence:null,trackingVerifications:[],
 now:"2026-09-20T09:00:00Z"
 }};
}
Deno.test("complete evidence is ready for AI; approval needs the exact bound AI result",async()=>{
 const {invoice,context}=fixture();assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 const ai={status:"passed" as const,findings:[],provider_request_id:"request",model:"configured-gpt4o",prompt_version:"v1",payload_sha256:await assessedDigest(invoice,context),physical_goods_detected:false};
 assert.equal((await assessWithAi(invoice,context,ai)).status,"approved");
 invoice.items[0].unit_amount_minor++;
 await assert.rejects(()=>assessWithAi(invoice,context,ai),/does not match/);
});
Deno.test("integer minor-unit totals reject fractional, negative and unsafe amounts",()=>{
 const {invoice}=fixture();assert.equal(invoiceTotalMinor(invoice.items),12500);
 for(const n of [-1,0,12.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity])assert.equal(invoiceTotalMinor([{...invoice.items[0],unit_amount_minor:n}]),null);
 assert.equal(invoiceTotalMinor([{...invoice.items[0],quantity:2,unit_amount_minor:Number.MAX_SAFE_INTEGER}]),null);
});
Deno.test("personal remitter and mismatched buyer stay flagged even after extra documents",()=>{
 const {invoice,context}=fixture();invoice.remitter.legal_name="Example Person";invoice.remitter.type="individual";
 invoice.documents.push({id:"contract",kind:"executed_contract",sha256:h("d")});
 const result=evaluateInvoice(invoice,context);assert.ok(result.reasons.includes("remitter_mismatch"));assert.ok(result.reasons.includes("individual_commercial_buyer"));
});
Deno.test("vague purpose, missing source of funds and unsigned contract cannot pass",()=>{
 const {invoice,context}=fixture();invoice.items[0].description="IT";invoice.source_of_funds="";invoice.agreement.signature_sha256="";
 const result=evaluateInvoice(invoice,context);assert.equal(result.status,"action_required");
 for(const reason of ["vague_description","source_of_funds_missing","signature_missing"])assert.ok(result.reasons.includes(reason as any));
});
Deno.test("cross-border needs discovery and sourcing justification; operating geography cannot replace incorporation",()=>{
 const {invoice,context}=fixture();invoice.buyer.country="FR";
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("cross_border_context_missing"));
 invoice.discovery_channel="Buyer contacted us through the published enterprise sales page.";
 invoice.cross_border_justification="Buyer required this specific licensed software with existing integration support unavailable from its current local supplier.";
 assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 invoice.merchant.incorporation_country="FR";assert.ok(evaluateInvoice(invoice,context).reasons.includes("invoice_incomplete"));
});
Deno.test("physical goods require logistics and verified fulfillment evidence; typed tracking is insufficient",()=>{
 const {invoice,context}=fixture();invoice.category="physical_goods";invoice.tracking_numbers=["TRACK-1"];
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("logistics_missing"));
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("fulfillment_proof_missing"));
 invoice.documents.push({id:"logistics",kind:"logistics",sha256:h("d")},{id:"warehouse",kind:"warehouse_receipt",sha256:h("e")});
 context.verifiedEvidenceHashes.push(h("d"),h("e"));assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 invoice.documents=invoice.documents.filter(d=>d.kind!=="warehouse_receipt");
 context.trackingVerifications=[{number:"TRACK-1",status:"active",checked_at:context.now,verified_by:"carrier_api"}];
 assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 context.trackingVerifications[0].checked_at="2026-09-17T09:00:00Z";assert.ok(evaluateInvoice(invoice,context).reasons.includes("fulfillment_proof_missing"));
});
Deno.test("government and same-currency aggregation need review, not an invented exemption",()=>{
 const {invoice,context}=fixture();invoice.buyer.legal_name="Obec Example";invoice.remitter.legal_name=invoice.buyer.legal_name;
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("government_buyer"));
 context.history={available:true,buyer_invoice_count_30d:5,same_currency_total_minor_30d:1100000};
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("possible_structuring"));
 context.history.available=false;assert.ok(evaluateInvoice(invoice,context).reasons.includes("history_unavailable"));
 context.jurisdictionPolicy=null;assert.ok(evaluateInvoice(invoice,context).reasons.includes("jurisdiction_policy_missing"));
});
function ecommerce(){
 const {invoice,context}=fixture();invoice.order_source="ecommerce";invoice.order_platform="Shopify";invoice.order_reference="ORDER-804";
 invoice.documents.push({id:"order",kind:"order_dashboard",sha256:h("d")});context.verifiedEvidenceHashes.push(h("d"));
 const evidence:OrderEvidence={document_sha256:h("d"),extraction_status:"succeeded",confidence:0.999,
 buyer_name:invoice.buyer.legal_name,order_id:invoice.order_reference,currency:invoice.currency,total_minor:12500,
 items:invoice.items.map(i=>({description:i.description,quantity:i.quantity,unit_amount_minor:i.unit_amount_minor})),
 checkout_at:"2026-09-19T08:00:00Z",payment_status:"pending",fulfillment_status:"unfulfilled",order_history_present:true,ip_device_context_present:true};
 context.orderEvidence=evidence;return {invoice,context,evidence};
}
Deno.test("e-commerce and CRM need linked OCR and exact order reconciliation",()=>{
 const {invoice,context,evidence}=ecommerce();assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 for(const source of ["ecommerce","crm"] as const){invoice.order_source=source;context.orderEvidence=null;assert.ok(evaluateInvoice(invoice,context).reasons.includes("order_extraction_unavailable"));}
 context.orderEvidence=evidence;
 for(const patch of [{currency:"EUR"},{total_minor:12499},{buyer_name:"Another Buyer Ltd"},{order_id:"other"}]){
  assert.ok(compareOrderEvidence(invoice,{...evidence,...patch},context.now).includes("order_mismatch"));
 }
 const changed=structuredClone(evidence);changed.items[0].description="Different commercial item";
 assert.ok(compareOrderEvidence(invoice,changed,context.now).includes("order_mismatch"));
 evidence.confidence=0.8;assert.ok(evaluateInvoice(invoice,context).reasons.includes("order_extraction_unavailable"));
 evidence.confidence=0.999;evidence.ip_device_context_present=false;assert.ok(evaluateInvoice(invoice,context).reasons.includes("order_context_missing"));
});
Deno.test("CRM evidence from another file cannot satisfy review; metadata is not verified evidence",()=>{
 const {invoice,context,evidence}=ecommerce();evidence.document_sha256=h("f");
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("order_extraction_unavailable"));
 context.verifiedEvidenceHashes=[];assert.ok(evaluateInvoice(invoice,context).reasons.includes("evidence_unverified"));
});
Deno.test("Azure failure, refusal, malformed or contradictory output never grants approval",async()=>{
 const {invoice,context}=fixture();const config={endpoint:"https://example.openai.azure.com",apiKey:"test-key",deployment:"gpt4o-test",apiVersion:"2024-10-21"};
 for(const response of [new Response("{}",{status:429}),new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{refusal:"refused"}}]})),
 new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({status:"passed",findings:[{code:"structuring",explanation:"Review"}],physical_goods_detected:false})}}]}))]){
  const ai=await screenInvoice(invoice,context,config,async()=>response);assert.equal(ai.status,"unavailable");assert.notEqual((await assessWithAi(invoice,context,ai)).status,"approved");
 }
 let requested=false;await screenInvoice(invoice,context,{...config,endpoint:"http://localhost"},async()=>{requested=true;throw Error("no");});assert.equal(requested,false);
});
Deno.test("Azure JSON cannot overwrite audit binding; model-detected physical goods add requirements",async()=>{
 const {invoice,context}=fixture();const config={endpoint:"https://example.openai.azure.com",apiKey:"test-key",deployment:"gpt4o-test",apiVersion:"2024-10-21"};
 const ai=await screenInvoice(invoice,context,config,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.match(body.messages[0].content,/untrusted evidence/);assert.equal(body.response_format.type,"json_schema");
  return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({status:"passed",findings:[],physical_goods_detected:true,payload_sha256:"forged",model:"forged"})}}]}));
 });
 assert.equal(ai.model,"gpt4o-test");assert.equal(ai.payload_sha256,await assessedDigest(invoice,context));
 const result=await assessWithAi(invoice,context,ai);assert.ok(result.reasons.includes("document_classification_conflict"));assert.ok(result.reasons.includes("logistics_missing"));
});

Deno.test("receiving account must be the selected active merchant VA in the invoice currency",()=>{
 const {invoice,context}=fixture();assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 for(const patch of [{id:"other-va"},{owner_user_id:"another-merchant"},{currency:"EUR"},{status:"paused"}]){
  const changed=structuredClone(context);Object.assign(changed.receivingAccount!,patch);
  assert.ok(evaluateInvoice(invoice,changed).reasons.includes("receiving_account_invalid"));
 }
 context.receivingAccount=null;assert.ok(evaluateInvoice(invoice,context).reasons.includes("receiving_account_invalid"));
});
Deno.test("GBP bank instructions are strictly corporate B2B",()=>{
 for(const type of ["individual","sole_proprietor","government"] as const){
  const {invoice,context}=fixture();invoice.buyer.type=type;invoice.remitter.type=type;
  const result=evaluateInvoice(invoice,context);
  assert.equal(result.status,"action_required");assert.ok(result.reasons.includes("gbp_b2b_only"));
 }
 const {invoice,context}=fixture();invoice.remitter.type="individual";
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("gbp_b2b_only"));
});

Deno.test("approved invoice formats the selected GBP account including sort code without initiating payment",async()=>{
 const {invoice,context}=fixture();
 const approval={status:"approved",payload_sha256:await assessedDigest(invoice,context),policy_version:"borderpay-predeposit-2.4.0",approval_expires_at:"2026-09-21T09:00:00Z",dossier_sha256:h("e")};
 const account={id:"va-gbp-1",owner_user_id:"merchant-1",currency:"GBP",status:"active",beneficiary_name:"Verified GBP Beneficiary",bank_name:"Example Bank",account_number:"12345678",sort_code:"12-34-56",required_payment_reference:"PROVIDER-REF"};
 const result=await generateBankPaymentInstructions("merchant-1",invoice,context,approval,account);
 assert.equal(result.amount,"125.00");assert.equal(result.sort_code,"12-34-56");assert.equal(result.beneficiary_name,"Verified GBP Beneficiary");assert.equal(result.required_payment_reference,"PROVIDER-REF");
 await assert.rejects(()=>generateBankPaymentInstructions("other-user",invoice,context,approval,account));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,{...approval,status:"review_required"},account));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,approval,{...account,status:"paused"}));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,approval,{...account,sort_code:""}));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,{...approval,approval_expires_at:"2026-09-19T00:00:00Z"},account));
 invoice.remitter.type="individual";approval.payload_sha256=await assessedDigest(invoice,context);
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,approval,account));
});
