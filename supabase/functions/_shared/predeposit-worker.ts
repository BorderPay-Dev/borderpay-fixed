import { checked, loadPolicy, loadAssetBytes, BUCKET, invoiceDossier } from "./predeposit-runtime.ts";
import { applyInvoiceReviewMode, applyDocumentReviewScope, evaluateInvoice, assessedDigest, canonicalJson, sha256, type ReviewContext } from "./predeposit-policy.ts";
import { screenInvoice, assessWithAi } from "./predeposit-azure.ts";
import { loadEvidenceOcrConfig, startEvidenceOcr, pollEvidenceOcr } from "./predeposit-evidence-ocr.ts";
import { loadInvoiceAiConfig } from "./predeposit-ai-config.ts";
import { extractCommercialEvidence } from "./predeposit-extract.ts";
export async function buildAssessment(db:any,row:any,manualContext?:Partial<ReviewContext>){
 const policy=await loadPolicy(db),context:ReviewContext=structuredClone(row.review_context);
 context.now=new Date().toISOString();
 if(row.review_context.config_sha256!==await sha256(canonicalJson(policy.config)))return {pending:false,context,assessment:{...evaluateInvoice(row.payload,context),status:policy.config?.review_mode==="automatic"?"action_required":"review_required",reasons:["policy_changed"],payload_sha256:row.payload_sha256,policy_version:row.policy_version}};
 const aiConfig=await loadInvoiceAiConfig(db);
 const docs=row.payload.documents;
 const assets:any[]=docs.length?checked<any[]>(await db.from("predeposit_assets").select("*").eq("owner_user_id",row.owner_user_id).in("id",docs.map((d:any)=>d.id))):[];
 if(assets.length!==docs.length||assets.some(a=>!docs.some((d:any)=>d.id===a.id&&d.sha256===a.sha256)))throw Error("Evidence integrity mismatch");
 context.verifiedEvidenceHashes=assets.filter(a=>a.scan_status==="clean"&&a.verification_status==="verified").map(a=>a.sha256);
 const saved=checked<any>(await db.from("predeposit_processing_jobs").select("jobs").eq("invoice_id",row.id).maybeSingle());
 const jobs:any=saved?.jobs||{};
 const ocrConfig=await loadEvidenceOcrConfig(db);
 let pending=false;
 for(const asset of assets.filter(a=>["executed_contract","order_dashboard","platform_order_export"].includes(a.kind))){
  if(asset.scan_status==="rejected")continue;
  const kind=asset.kind==="executed_contract"?"contract":"order";
  let job=jobs[asset.id];
  if(!job && ocrConfig.endpoint&&ocrConfig.apiKey){job={ocr:await startEvidenceOcr(await loadAssetBytes(db,asset),asset.mime_type,ocrConfig)};jobs[asset.id]=job;}
  if(job?.ocr?.status==="pending"&&!job.result){
   const result=await pollEvidenceOcr(job.ocr,ocrConfig);
   if(result.status==="pending")pending=true;else job.result=result;
  }
  if(job?.result?.status==="succeeded"&&!job.extractionAttempted){job.extracted=await extractCommercialEvidence(job.result,kind,aiConfig);job.extractionAttempted=true;}
  if(job?.extracted){if(kind==="contract")context.contractEvidence=job.extracted;else context.orderEvidence=job.extracted;}
 }
 checked(await db.from("predeposit_processing_jobs").upsert({invoice_id:row.id,jobs,updated_at:new Date().toISOString()},{onConflict:"invoice_id"}));
 if(pending)return {pending:true,context,assessment:null};
 const verified=checked<any[]>(await db.from("predeposit_evidence_verifications").select("patch").eq("invoice_id",row.id).order("created_at"));
 for(const verification of verified){Object.assign(context,verification.patch);}
 if(manualContext){
  // Only the admin handler may construct this patch after an audited review.
  if(manualContext.contractEvidence)context.contractEvidence=manualContext.contractEvidence;
  if(manualContext.orderEvidence)context.orderEvidence=manualContext.orderEvidence;
  if(manualContext.trackingVerifications)context.trackingVerifications=manualContext.trackingVerifications;
 }
 const deterministic=evaluateInvoice(row.payload,context);
 const ai=await screenInvoice(row.payload,context,aiConfig);
 const strict=await assessWithAi(row.payload,context,ai);
 const scoped=applyDocumentReviewScope(strict,context,policy.config?.review_scope,policy.mode);
 const result=applyInvoiceReviewMode(scoped,policy.config?.review_mode);
 return {pending:false,context,assessment:{...result,payload_sha256:row.payload_sha256,assessed_sha256:await assessedDigest(row.payload,context),review_context:context,config_sha256:row.review_context.config_sha256,deterministic_status:deterministic.status}};
}
export async function processInvoice(db:any,id:string){
 const row=checked<any>(await db.rpc("claim_predeposit_invoice",{p_invoice_id:id}));if(!row)return;
 try{
  const result=await buildAssessment(db,row);
  if(result.pending){
   checked(await db.from("predeposit_invoices").update({lease_id:null,lease_until:new Date(Date.now()+30000).toISOString()}).eq("id",row.id).eq("lease_id",row.lease_id));return;
  }
  const a:any=result.assessment;let dossier:{path:string;sha256:string}|null=null;
  if(a.status==="approved")dossier=await invoiceDossier(db,{...row,assessment:a},result.context);
  checked(await db.rpc("complete_predeposit_review",{p_invoice:row.id,p_lease:row.lease_id,p_actor:null,p_decision:a.status==="ready_for_ai"?"review_required":a.status,
   p_assessment:a,p_dossier_path:dossier?.path||null,p_dossier_sha:dossier?.sha256||null,p_rationale:"Automated evidence assessment for this invoice revision"}));
 }catch{
  // Never expose provider responses or document content in client errors.
  let automatic=false;try{automatic=(await loadPolicy(db)).config?.review_mode==="automatic";}catch{/* Unavailable policy cannot grant approval. */}
  const assessment={status:automatic?"action_required":"review_required",policy_version:row.policy_version,payload_sha256:row.payload_sha256,reasons:["screening_unavailable"]};
  await db.rpc("complete_predeposit_review",{p_invoice:row.id,p_lease:row.lease_id,p_actor:null,p_decision:assessment.status,p_assessment:assessment,p_dossier_path:null,p_dossier_sha:null,p_rationale:"Automated document checks could not complete; no approval granted"});
 }
}
