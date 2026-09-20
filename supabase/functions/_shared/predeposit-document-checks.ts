import {checked,loadAssetBytes} from "./predeposit-runtime.ts";
import {loadEvidenceOcrConfig,startEvidenceOcr,pollEvidenceOcr} from "./predeposit-evidence-ocr.ts";
import {loadInvoiceAiConfig} from "./predeposit-ai-config.ts";
import {reviewDocumentPair,DOCUMENT_CHECK_VERSION} from "./predeposit-document-comparison.ts";
export function validateReviewAssets(owner:string,invoice:any,contract:any){
 if(!invoice||!contract||invoice.id===contract.id||invoice.owner_user_id!==owner||contract.owner_user_id!==owner
  ||invoice.kind!=="merchant_invoice"||invoice.mime_type!=="application/pdf"||contract.kind!=="executed_contract"
  ||[invoice,contract].some(a=>a.scan_status==="rejected"||a.verification_status==="rejected"))
  throw Error("Select your own invoice PDF and contract to review");
}
export async function processDocumentCheck(db:any,id:string){
 const row=checked<any>(await db.rpc("claim_predeposit_document_check",{p_id:id}));if(!row)return;
 const persist=async(values:any)=>checked(await db.from("predeposit_document_checks").update({...values,updated_at:new Date().toISOString()}).eq("id",id).eq("lease_id",row.lease_id).gt("lease_until",new Date().toISOString()));
 try{
  if(row.prompt_version!==DOCUMENT_CHECK_VERSION)throw Error("Review version changed");
  const assets=checked<any[]>(await db.from("predeposit_assets").select("*").eq("owner_user_id",row.owner_user_id).in("id",[row.invoice_asset_id,row.contract_asset_id]));
  const invoice=assets.find(a=>a.id===row.invoice_asset_id),contract=assets.find(a=>a.id===row.contract_asset_id);
  validateReviewAssets(row.owner_user_id,invoice,contract);
  if(invoice.sha256!==row.invoice_sha256||contract.sha256!==row.contract_sha256)throw Error("Document hash changed");
  const config=await loadEvidenceOcrConfig(db),jobs=row.jobs||{};
  let pending=false;
  for(const [kind,asset]of [["invoice",invoice],["contract",contract]] as const){
   if(!jobs[kind])jobs[kind]={ocr:await startEvidenceOcr(await loadAssetBytes(db,asset),asset.mime_type,config)};
   const job=jobs[kind];
   if(job.ocr.status==="failed")throw Error("Document could not be read");
   if(!job.result)job.result=await pollEvidenceOcr(job.ocr,config);
   if(job.result.status==="pending"){delete job.result;pending=true;}
   else if(job.result.status!=="succeeded"||job.result.document_sha256!==asset.sha256)throw Error("Document extraction failed");
  }
  if(pending){await persist({jobs,status:"queued",lease_id:null,lease_until:new Date(Date.now()+15000).toISOString()});return;}
  const result=await reviewDocumentPair(jobs.invoice.result,jobs.contract.result,row.merchant_name,await loadInvoiceAiConfig(db));
  await persist({jobs,result,status:result.status,lease_id:null,lease_until:null});
 }catch{
  await persist({status:"unavailable",lease_id:null,lease_until:null,result:{status:"unavailable",authenticity_verified:false,
   findings:[{code:"review_unavailable",explanation:"We could not finish reading these documents. Please try again with complete, readable PDFs. Your files and payment access are unchanged."}]}});
 }
}
