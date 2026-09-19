/**
 * Server-authenticated synthetic acceptance probe.
 * No customer identity, storage object, invoice row, provider account or approval is written.
 * Fixture policy and verified hashes are test inputs only, never production approvals.
 */
import { buildAssessment } from "./predeposit-worker.ts";
import { canonicalJson, sha256, POLICY_VERSION, type Invoice, type ReviewContext } from "./predeposit-policy.ts";
import { loadInvoiceAiConfig } from "./predeposit-ai-config.ts";
import { screenInvoice } from "./predeposit-azure.ts";
import { generateBankPaymentInstructions } from "./predeposit-payment-instructions.ts";
function pdf(lines:string[]):Uint8Array{
 const stream="BT /F1 12 Tf 40 790 Td "+lines.map((s,i)=>(i?"0 -22 Td ":"")+"("+s.replace(/[\\()]/g,"\\$&")+") Tj").join("\n")+" ET";
 const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+new TextEncoder().encode(stream).length+" >>\nstream\n"+stream+"\nendstream"];
 let body="%PDF-1.4\n";const offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(new TextEncoder().encode(body).length);body+=(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";}
 const start=new TextEncoder().encode(body).length;
 body+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(o=>String(o).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF";
 return new TextEncoder().encode(body);
}
export async function runPredepositSelfTest(realDb:any,assess:typeof buildAssessment=buildAssessment){
 const configResponse=await realDb.rpc("predeposit_ocr_config");
 const aiConfigResponse=assess===buildAssessment?await realDb.rpc("predeposit_ai_config"):{data:{},error:null};
 if(configResponse.error||!configResponse.data?.endpoint||!configResponse.data?.apiKey)throw Error("OCR configuration unavailable");
 const owner="00000000-0000-4000-8000-000000000001",account="synthetic-receiving-account";
 const policy={config:{jurisdiction_policy:{version:"TEST-ONLY",known_countries:["GB"],review_countries:[]},structuring:{max_invoices_30d:20,aggregate_review_minor:{GBP:100000000}}}};
 const now=new Date().toISOString(),hash="a".repeat(64);
 const base:Invoice={
  id:"SYNTHETIC-NOT-PAYABLE",revision:1,currency:"GBP",receiving_account_id:account,
  merchant:{legal_name:"Example Software Limited",incorporation_country:"GB"},
  buyer:{legal_name:"Example Buyer Limited",type:"company",address:"10 Example Street, London",country:"GB",tax_id:"TEST-GB-001"},
  remitter:{legal_name:"Example Buyer Limited",type:"company",relationship:"Corporate buyer paying its own software subscription invoice"},
  category:"digital_services",order_source:"direct_b2b",order_platform:"",order_reference:"",tracking_numbers:[],
  items:[{description:"Enterprise software subscription September 2026 for 10 seats",quantity:1,unit_amount_minor:125000,deliverable_reference:"LICENSE-SEP-2026"}],
  source_of_funds:"Corporate operating revenue held in the buyer's own business bank account",
  fund_utilization:"Cloud hosting and software engineering costs for the contracted subscription",
  discovery_channel:"",cross_border_justification:"",commercial_end_use:"",
  contract_path:"generated",agreement:{version:"TEST-ONLY",terms_sha256:hash,signature_sha256:hash,signed_by:"Synthetic Test Signer",signed_at:now,signature_consent:true},
  documents:[{id:"synthetic-agreement",kind:"signed_agreement",sha256:hash}],instalments:{expected_count:1,commercial_reason:"Single monthly subscription invoice"}};
 const context:ReviewContext={merchantUserId:owner,receivingAccount:{id:account,owner_user_id:owner,currency:"GBP",status:"active"},
  verifiedMerchant:{...base.merchant,active:true,approved:true},jurisdictionPolicy:policy.config.jurisdiction_policy,
  approvedAgreementVersions:["TEST-ONLY"],history:{available:true,buyer_invoice_count_30d:0,same_currency_total_minor_30d:0},
  structuring:policy.config.structuring,verifiedEvidenceHashes:[hash],orderEvidence:null,contractEvidence:null,trackingVerifications:[],now};
 const results:any[]=[];
 let modelDiagnostic:any=null;
 if(assess===buildAssessment){
  const config=await loadInvoiceAiConfig(realDb);let host:string|null=null;try{host=new URL(config.endpoint).hostname;}catch{}
  modelDiagnostic={endpoint_present:!!config.endpoint,endpoint_host:host,deployment:config.deployment,api_version:config.apiVersion,key_present:!!config.apiKey,request_sent:false};
  const probe=await screenInvoice(base,context,config,async(input,init)=>{
   modelDiagnostic.request_sent=true;
   const response=await fetch(input,init);modelDiagnostic.http_status=response.status;
   if(!response.ok){try{const data=await response.clone().json();modelDiagnostic.error_code=data?.error?.code||null;modelDiagnostic.error_param=data?.error?.param||null;}catch{}}
   return response;
  });
  modelDiagnostic.result=probe.status;
 }

 const contract=pdf(["SYNTHETIC TEST CONTRACT - NOT PAYABLE","Seller: Example Software Limited","Buyer: Example Buyer Limited","Currency: GBP","Total contract value: GBP 1250.00","Enterprise software subscription September 2026 for 10 seats","Delivery reference: LICENSE-SEP-2026","Seller signature: Synthetic Test Signer","Buyer signature: Synthetic Buyer Signer"]);
 const contractHash=await sha256(contract);
 const definitions=[
  {name:"matching_generated_agreement",expected:"approved",edit:(_i:Invoice)=>{}},
  {name:"missing_agreement",expected:"action_required",edit:(i:Invoice)=>{i.documents=[];}},
  {name:"gbp_individual_buyer",expected:"action_required",edit:(i:Invoice)=>{i.buyer.type="individual";i.remitter.type="individual";}},
  {name:"custom_contract_matching",expected:"review_required",edit:(i:Invoice)=>{i.contract_path="custom";i.documents=[{id:"synthetic-contract",kind:"executed_contract",sha256:contractHash}];}},
  {name:"custom_contract_amount_mismatch",expected:"not_approved",edit:(i:Invoice)=>{i.contract_path="custom";i.documents=[{id:"synthetic-contract",kind:"executed_contract",sha256:contractHash}];i.items[0].unit_amount_minor=150000;}}
 ];
 // Reuse the same immutable contract OCR within this probe; no second paid OCR call.
 let cachedContractJob:any=null;
 for(const definition of definitions){
  const invoice=structuredClone(base);definition.edit(invoice);
  const row={id:crypto.randomUUID(),owner_user_id:owner,payload:invoice,payload_sha256:await sha256(canonicalJson(invoice)),policy_version:POLICY_VERSION,
   review_context:{...structuredClone(context),config_sha256:await sha256(canonicalJson(policy.config))}};
  const assets=invoice.documents.map(d=>({...d,owner_user_id:owner,storage_path:d.id,mime_type:"application/pdf",size_bytes:d.id==="synthetic-contract"?contract.length:1,scan_status:"clean",verification_status:"verified"}));
  let jobs:any=cachedContractJob&&invoice.contract_path==="custom"?{"synthetic-contract":structuredClone(cachedContractJob)}:{};
  const db={
   rpc:async(name:string)=>{if(name==="predeposit_ocr_config")return configResponse;if(name==="predeposit_ai_config")return aiConfigResponse;throw Error("Unexpected test RPC");},
   storage:{from:(bucket:string)=>({download:async(path:string)=>{if(bucket!=="predeposit-evidence"||path!=="synthetic-contract")throw Error("Unexpected test document");return {data:new Blob([contract as BlobPart]),error:null};}})},
   from:(table:string)=>{
    let mutation:any;const q:any={
     select:()=>q,eq:()=>q,in:()=>q,order:()=>q,single:()=>q,maybeSingle:()=>q,
     upsert:(value:any)=>{if(table!=="predeposit_processing_jobs")throw Error("Unexpected test write");mutation=value;return q;},
     then:(resolve:any,reject:any)=>Promise.resolve().then(()=>{
      if(table==="predeposit_policy")return {data:policy,error:null};
      if(table==="predeposit_assets")return {data:assets,error:null};
      if(table==="predeposit_evidence_verifications")return {data:[],error:null};
      if(table==="predeposit_processing_jobs"){if(mutation)jobs=mutation.jobs;return {data:{jobs},error:null};}
      throw Error("Unexpected test table");
     }).then(resolve,reject)
    };return q;
   }
  };
  let outcome:any;const until=Date.now()+60000;
  do{outcome=await assess(db,row);if(!outcome.pending)break;await new Promise(r=>setTimeout(r,1500));}while(Date.now()<until);
  if(jobs["synthetic-contract"]?.result?.status==="succeeded")cachedContractJob=jobs["synthetic-contract"];
  let locked=true;
  try{
   await generateBankPaymentInstructions(owner,invoice,outcome.context,{status:"review_required",payload_sha256:row.payload_sha256,policy_version:POLICY_VERSION,
    approval_expires_at:new Date(Date.now()+60000).toISOString(),dossier_sha256:hash},
    {id:account,owner_user_id:owner,currency:"GBP",status:"active",beneficiary_name:"Synthetic",bank_name:"Synthetic",account_number:"00000000",sort_code:"000000"});
   locked=false;
  }catch{/* Expected: no persisted approval, no payment instructions. */}
  results.push({case:definition.name,expected:definition.expected,status:outcome.assessment?.status||"pending",
   ai_status:outcome.assessment?.ai?.status||null,reasons:outcome.assessment?.reasons||[],
   contract_ocr:jobs["synthetic-contract"]?.result?.status||null,
   contract_extracted:!!outcome.context?.contractEvidence,
   extracted_total_minor:outcome.context?.contractEvidence?.total_minor??null,
   evidence_confidence:outcome.context?.contractEvidence?.confidence??null,
   bank_details_locked:locked});
 }
 return {model_diagnostic:modelDiagnostic,synthetic:true,production_records_written:0,provider_accounts_called:0,policy_source:"isolated_test_fixture",
  all_expected:results.every(r=>r.bank_details_locked&&(r.expected==="not_approved"?r.status!=="approved":r.status===r.expected)),results};
}
