import {agreementType, assertTemplateType, assertAgreementSale} from "../supabase/functions/_shared/predeposit-agreement.ts";
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
 contract_path:"generated",agreement:{signature_consent:true,version:"counsel-approved-v1",terms_sha256:h("a"),signature_sha256:h("b"),signed_by:"Example Director",signed_at:"2026-09-19T09:00:00Z"},
 documents:[{id:"agreement-1",kind:"signed_agreement",sha256:h("c")}],
 instalments:{expected_count:1,commercial_reason:""}
 },context:{
 merchantUserId:"merchant-1",receivingAccount:{id:"va-gbp-1",owner_user_id:"merchant-1",currency:"GBP",status:"active"},
 verifiedMerchant:{legal_name:"Example Merchant Ltd",incorporation_country:"GB",active:true,approved:true},
 jurisdictionPolicy:{version:"approved-test-policy",known_countries:["GB","FR","LV"],review_countries:[]},
 approvedAgreementVersions:["counsel-approved-v1"],
 history:{available:true,buyer_invoice_count_30d:0,same_currency_total_minor_30d:0},
 structuring:{max_invoices_30d:4,aggregate_review_minor:{USD:1000000,EUR:1000000,GBP:1000000}},
 verifiedEvidenceHashes:[h("c")],orderEvidence:null,contractEvidence:null,trackingVerifications:[],
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
 const result=await generateBankPaymentInstructions("merchant-1",invoice,context,approval,account,context.now);
 assert.equal(result.amount,"125.00");assert.equal(result.sort_code,"12-34-56");assert.equal(result.beneficiary_name,"Verified GBP Beneficiary");assert.equal(result.required_payment_reference,"PROVIDER-REF");
 await assert.rejects(()=>generateBankPaymentInstructions("other-user",invoice,context,approval,account,context.now));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,{...approval,status:"review_required"},account,context.now));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,approval,{...account,status:"paused"},context.now));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,approval,{...account,sort_code:""},context.now));
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,{...approval,approval_expires_at:"2026-09-19T00:00:00Z"},account,context.now));
 invoice.remitter.type="individual";approval.payload_sha256=await assessedDigest(invoice,context);
 await assert.rejects(()=>generateBankPaymentInstructions("merchant-1",invoice,context,approval,account,context.now));
});

Deno.test("USD and EUR instruction blocks expose only the selected account's currency fields",async()=>{
 for(const currency of ["USD","EUR"] as const){
  const {invoice,context}=fixture();invoice.currency=currency;invoice.receiving_account_id="va-"+currency;
  context.receivingAccount={id:invoice.receiving_account_id,owner_user_id:context.merchantUserId,currency,status:"active"};
  const approval={status:"approved",payload_sha256:await assessedDigest(invoice,context),policy_version:"borderpay-predeposit-2.4.0",approval_expires_at:"2026-09-21T09:00:00Z",dossier_sha256:h("e")};
  const account={id:invoice.receiving_account_id,owner_user_id:context.merchantUserId,currency,status:"active",beneficiary_name:"Correct Account Beneficiary",bank_name:"Example Bank",account_number:"123456789",routing_number:"123456789",iban:"GB00EXAMPLE00000000000000",bic:"EXAMPLEXXX",sort_code:"123456"};
  const result=await generateBankPaymentInstructions(context.merchantUserId,invoice,context,approval,account,context.now);
  assert.equal(result.currency,currency);assert.equal(result.account_id,invoice.receiving_account_id);assert.equal(result.sort_code,undefined);
  if(currency==="USD"){assert.equal(result.routing_number,"123456789");assert.equal(result.iban,undefined);}
  else{assert.equal(result.iban,account.iban);assert.equal(result.bic,account.bic);assert.equal(result.routing_number,undefined);assert.equal(result.account_number,undefined);}
  await assert.rejects(()=>generateBankPaymentInstructions(context.merchantUserId,invoice,context,approval,account,"2026-09-22T00:00:00Z"));
 }
});

function customContract(){
 const {invoice,context}=fixture();invoice.contract_path="custom";
 invoice.documents=[{id:"custom-contract",kind:"executed_contract",sha256:h("d")}];context.verifiedEvidenceHashes=[h("d")];
 context.approvedAgreementVersions=[];
 context.contractEvidence={document_sha256:h("d"),extraction_status:"succeeded",confidence:0.999,seller_name:invoice.merchant.legal_name,buyer_name:invoice.buyer.legal_name,currency:invoice.currency,total_minor:12500,
 commercial_scope:"Provision of the September 2026 enterprise SaaS licence with 20 seats under the documented commercial agreement.",
 seller_signature_present:true,buyer_signature_present:true,execution_verified:true,verification_source:"digital_signature_validation"};
 return {invoice,context};
}
Deno.test("custom contract can satisfy the contract requirement without a generated template",async()=>{
 const {invoice,context}=customContract();assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
 const ai={status:"passed" as const,findings:[],provider_request_id:"request",model:"configured-gpt4o",prompt_version:"v1",payload_sha256:await assessedDigest(invoice,context),physical_goods_detected:false};
 assert.equal((await assessWithAi(invoice,context,ai)).status,"approved");
});
Deno.test("custom contract mismatches give specific correction reasons",()=>{
 for(const [patch,reason] of [
  [{seller_name:"Wrong Seller"},"contract_entity_mismatch"],[{buyer_name:"Wrong Buyer"},"contract_entity_mismatch"],
  [{total_minor:12501},"contract_value_mismatch"],[{currency:"EUR"},"contract_value_mismatch"],
  [{commercial_scope:"Services"},"contract_scope_missing"],[{seller_signature_present:false},"contract_signatures_missing"],
  [{buyer_signature_present:false},"contract_signatures_missing"]
 ] as const){
  const {invoice,context}=customContract();Object.assign(context.contractEvidence!,patch);
  const result=evaluateInvoice(invoice,context);assert.equal(result.status,"action_required");assert.ok(result.reasons.includes(reason));
 }
});
Deno.test("OCR signature detection alone cannot establish execution or approve mismatched evidence",()=>{
 const {invoice,context}=customContract();context.contractEvidence!.execution_verified=false;context.contractEvidence!.verification_source="unverified";
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("contract_execution_unverified"));
 context.contractEvidence!.document_sha256=h("e");assert.ok(evaluateInvoice(invoice,context).reasons.includes("contract_extraction_unavailable"));
 context.contractEvidence=null;assert.ok(evaluateInvoice(invoice,context).reasons.includes("contract_extraction_unavailable"));
});
Deno.test("saved signature requires consent for each generated agreement; contract pass never bypasses GBP",()=>{
 const {invoice,context}=fixture();invoice.agreement.signature_consent=false;
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("signature_missing"));
 const custom=customContract();custom.invoice.remitter.type="individual";
 assert.ok(evaluateInvoice(custom.invoice,custom.context).reasons.includes("gbp_b2b_only"));
});

import {applyInvoiceReviewMode,type Assessment} from "../supabase/functions/_shared/predeposit-policy.ts";
Deno.test("manual and unconfigured launch modes cannot accept AI-only approval",()=>{
 const approved={status:"approved",reasons:[]} as unknown as Assessment;
 for(const mode of ["manual",undefined,null,"typo",true]){
  const result=applyInvoiceReviewMode(approved,mode);
  if(result.status!=="review_required"||!result.reasons.includes("manual_review_required"))throw Error("AI approval escaped manual gate");
 }
 if(approved.status!=="approved"||approved.reasons.length)throw Error("Input assessment was mutated");
 if(applyInvoiceReviewMode(approved,"automatic").status!=="approved")throw Error("Explicit automatic mode lost approval");
 for(const status of ["action_required","review_required","ready_for_ai"] as const){
  const assessment={...approved,status};if(applyInvoiceReviewMode(assessment,"manual").status!==status)throw Error("Existing requirements changed");
 }
});

Deno.test("automatic mode returns unresolved checks for correction, never fabricates approval",async()=>{
 const {invoice,context}=fixture();
 const ai={status:"passed" as const,findings:[],provider_request_id:"test",model:"test",prompt_version:"test",
  payload_sha256:await assessedDigest(invoice,context),physical_goods_detected:false};
 const passed=applyInvoiceReviewMode(evaluateInvoice(invoice,context,ai),"automatic");
 assert.equal(passed.status,"approved");assert.ok(!passed.reasons.includes("manual_review_required"));
 const custom=customContract();custom.context.contractEvidence!.execution_verified=false;
 custom.context.contractEvidence!.verification_source="unverified";
 const uncertain=evaluateInvoice(custom.invoice,custom.context,ai);
 const decision=applyInvoiceReviewMode(uncertain,"automatic");
 assert.equal(decision.status,"action_required");
 assert.ok(decision.reasons.includes("contract_execution_unverified"));
 assert.equal(custom.context.contractEvidence!.execution_verified,false);
 assert.equal(uncertain.status,"review_required");
 for(const status of ["flagged","unavailable"] as const){
  const result=applyInvoiceReviewMode(evaluateInvoice(invoice,context,{...ai,status,findings:status==="flagged"?[{code:"document_conflict",explanation:"Check the actual order total."}]:[]}),"automatic");
  assert.equal(result.status,"action_required");
 }
 invoice.remitter.type="individual";
 assert.ok(applyInvoiceReviewMode(evaluateInvoice(invoice,context,ai),"automatic").reasons.includes("gbp_b2b_only"));
});

import {automatedReviewFeedback} from "../supabase/functions/_shared/predeposit-review-feedback.ts";
Deno.test("automated feedback works for existing clients and retains each audit finding",()=>{
 const assessment={status:"action_required",reasons:["contract_execution_unverified","ai_flagged"],ai:{findings:[{code:"document_conflict",explanation:"Invoice and contract totals differ."}]}};
 const result=automatedReviewFeedback(assessment,"automatic");
 assert.deepEqual(result.reasons,[]);
 assert.equal(result.findings.length,3);
 assert.ok(result.findings.some((f:any)=>f.code==="contract_execution_unverified"&&f.explanation.includes("cannot certify")));
 assert.deepEqual(assessment.reasons,["contract_execution_unverified","ai_flagged"]);
 assert.deepEqual(automatedReviewFeedback(assessment,"manual").reasons,assessment.reasons);
 const passed=automatedReviewFeedback({status:"approved",reasons:[]},"automatic");
 assert.match(passed.merchant_feedback,/does not certify authenticity/);
});

import {applyDocumentReviewScope} from "../supabase/functions/_shared/predeposit-policy.ts";
Deno.test("optional document checks do not invent missing bank policy or clear uncertain evidence",()=>{
 const {invoice,context}=fixture();context.jurisdictionPolicy=null;context.structuring=null;
 const ai={status:"passed" as const,findings:[],physical_goods_detected:false} as any;
 const strict=evaluateInvoice(invoice,context,ai);assert.equal(strict.status,"review_required");
 const documents=applyDocumentReviewScope(strict,context,"document_checks","observe");assert.equal(documents.status,"approved");
 assert.deepEqual((documents as any).checks_not_performed,["jurisdiction_policy_missing","history_unavailable"]);
 assert.ok((documents as any).strict_assessment.reasons.includes("jurisdiction_policy_missing"));
 for(const mode of ["enforce","disabled",undefined])assert.equal(applyDocumentReviewScope(strict,context,"document_checks",mode).status,"review_required");
 assert.equal(applyDocumentReviewScope(strict,context,undefined,"observe").status,"review_required");
 context.verifiedEvidenceHashes=[];assert.notEqual(applyDocumentReviewScope(evaluateInvoice(invoice,context,ai),context,"document_checks","observe").status,"approved");
 context.history.available=false;assert.ok(applyDocumentReviewScope(evaluateInvoice(invoice,context,ai),context,"document_checks","observe").reasons.includes("history_unavailable"));
});

Deno.test("consumer sales do not require business registration, but preserve payer and logistics checks",()=>{
 for(const type of ["d2c","b2c"] as const){
  const {invoice,context}=fixture();invoice.agreement_type=type;invoice.currency="EUR";context.receivingAccount!.currency="EUR";
  invoice.buyer={...invoice.buyer,type:"individual",legal_name:"Example Consumer",tax_id:""};
  invoice.remitter={...invoice.remitter,type:"individual",legal_name:"Example Consumer"};invoice.order_source="direct_consumer";
  invoice.consumer_terms={delivery:"Digital access within one business day",cancellations_returns:"Contact support for applicable withdrawal rights and refunds",support_contact:"support@example.test",additional_charges:"None"};
  assert.equal(evaluateInvoice(invoice,context).status,"ready_for_ai");
  invoice.remitter.legal_name="Different Person";assert.ok(evaluateInvoice(invoice,context).reasons.includes("remitter_mismatch"));
  invoice.remitter.legal_name=invoice.buyer.legal_name;invoice.category="physical_goods";
  assert.ok(evaluateInvoice(invoice,context).reasons.includes("logistics_missing"));
  invoice.consumer_terms.delivery="";assert.ok(evaluateInvoice(invoice,context).reasons.includes("consumer_terms_missing"));
 }
});
Deno.test("agreement type cannot bypass GBP or mix consumer templates with business buyers",()=>{
 assert.equal(agreementType(undefined),"b2b");
 assert.throws(()=>agreementType("unknown"),/Select/);
 const {invoice,context}=fixture();invoice.agreement_type="d2c";
 assert.ok(evaluateInvoice(invoice,context).reasons.includes("gbp_b2b_only"));
 assert.throws(()=>assertAgreementSale(invoice),/GBP/);
 invoice.currency="EUR";assert.throws(()=>assertAgreementSale(invoice),/individual consumer/);
 assert.throws(()=>assertTemplateType({agreement_type:"b2b"},invoice),/matching/);
 assert.doesNotThrow(()=>assertTemplateType({agreement_type:"d2c"},invoice));
});
