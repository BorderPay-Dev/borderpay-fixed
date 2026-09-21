import { loadPdfStyleAssets } from "./predeposit-pdf-assets.ts";
import { sha256, canonicalJson, invoiceTotalMinor, normalizedLegalName, evaluateInvoice, assessedDigest, POLICY_VERSION, type Invoice, type ReviewContext } from "./predeposit-policy.ts";
import { parseDraft } from "./predeposit-input.ts";
import { loadInvoiceAccounts } from "./predeposit-accounts.ts";
import { supportedEvidenceBytes } from "./predeposit-document-intelligence.ts";
import { renderInvoiceDocument } from "./predeposit-pdf.ts";
export const BUCKET="predeposit-evidence";
export function checked<T>(r:{data:T;error:any}):T{if(r.error)throw Error(r.error.message||"Database request failed");return r.data;}
export async function loadPolicy(db:any){const p=checked<any>(await db.from("predeposit_policy").select("*").eq("singleton",true).single());return p;}
export async function loadAssetBytes(db:any,a:any):Promise<Uint8Array>{
 const blob=checked<Blob>(await db.storage.from(BUCKET).download(a.storage_path));const bytes=new Uint8Array(await blob.arrayBuffer());
 if(bytes.length!==a.size_bytes || await sha256(bytes)!==a.sha256)throw Error("Stored evidence integrity check failed");return bytes;
}
export async function saveAsset(db:any,owner:string,kind:string,bytes:Uint8Array,mime:string,generated=false){
 if(!supportedEvidenceBytes(bytes,mime))throw Error("Upload a valid PDF, PNG or JPEG up to 20 MB");
 if(["logo","signature"].includes(kind)&&mime==="application/pdf")throw Error("Logo and signature must be PNG or JPEG");
 const id=crypto.randomUUID(),digest=await sha256(bytes),path=owner+"/"+id;
 checked(await db.storage.from(BUCKET).upload(path,bytes,{contentType:mime,upsert:false}));
 const row=checked<any>(await db.from("predeposit_assets").insert({id,owner_user_id:owner,kind,storage_path:path,sha256:digest,mime_type:mime,size_bytes:bytes.length,
  scan_status:generated?"clean":"pending",verification_status:generated?"verified":"pending",...(generated?{verified_at:new Date().toISOString()}: {})}).select("*").single());
 return row;
}
export async function fontBytes(db:any){
 const blob=checked<Blob>(await db.storage.from("predeposit-render-assets").download("NotoSans-Regular.ttf"));
 return new Uint8Array(await blob.arrayBuffer());
}
export async function contextFor(db:any,owner:string,invoice:Invoice,accounts:any,policy:any):Promise<ReviewContext>{
 const account=accounts.accounts.find((a:any)=>a.id===invoice.receiving_account_id);
 if(!account)throw Error("Select an active receiving account for this invoice");
 const buyerHash=await sha256(normalizedLegalName(invoice.buyer.legal_name)+"|"+invoice.buyer.country+"|"+invoice.buyer.tax_id);
 const since=new Date(Date.now()-30*86400000).toISOString();
 const history=await db.from("predeposit_invoices").select("total_minor,invoice_number").eq("owner_user_id",owner).eq("buyer_identity_hash",buyerHash).eq("currency",invoice.currency).gte("created_at",since).neq("status","rejected").limit(1001);
 const seen=new Map<string,number>();for(const r of history.data||[])seen.set(r.invoice_number,Number(r.total_minor));
 const verified=checked<any[]>(await db.from("predeposit_assets").select("sha256").eq("owner_user_id",owner).eq("verification_status","verified").eq("scan_status","clean"));
 const templates=checked<any[]>(await db.from("predeposit_agreement_templates").select("version").eq("status","approved"));
 return {merchantUserId:owner,receivingAccount:{id:account.id,owner_user_id:owner,currency:account.currency,status:account.status},
  verifiedMerchant:accounts.merchant,jurisdictionPolicy:policy.config?.jurisdiction_policy||null,approvedAgreementVersions:templates.map(t=>t.version),
  history:{available:!history.error&&(history.data||[]).length<=1000,buyer_invoice_count_30d:seen.size,same_currency_total_minor_30d:[...seen.values()].reduce((a,b)=>a+b,0)},
  structuring:policy.config?.structuring||null,verifiedEvidenceHashes:verified.map(a=>a.sha256),orderEvidence:null,contractEvidence:null,trackingVerifications:[],now:new Date().toISOString()};
}
export async function submitInvoice(db:any,owner:string,draftId:string,version:number){
 const draft=checked<any>(await db.from("predeposit_drafts").select("*").eq("id",draftId).eq("owner_user_id",owner).single());
 if(draft.version!==version)throw Error("Draft changed. Reload before submitting");
 const prior=checked<any>(await db.from("predeposit_invoices").select("id,status,revision").eq("owner_user_id",owner).eq("invoice_number",draft.invoice_number).eq("revision",version).maybeSingle());
 if(prior)return prior;
 const fields=parseDraft(draft.payload),policy=await loadPolicy(db),accounts=await loadInvoiceAccounts(db,owner);
 if(policy.config?.hub_enabled!==true)throw Error("Invoicing is not enabled");
 const branding=checked<any>(await db.from("predeposit_branding").select("*").eq("owner_user_id",owner).maybeSingle());
 const ids=[...new Set([...fields.document_ids,branding?.logo_asset_id,branding?.signature_asset_id].filter(Boolean))];
 const assets: any[]=ids.length?checked<any[]>(await db.from("predeposit_assets").select("*").eq("owner_user_id",owner).in("id",ids)):[];
 if(assets.length!==ids.length || assets.some(a=>a.scan_status==="rejected" || a.verification_status==="rejected"))throw Error("One or more documents are unavailable. Replace the rejected evidence");
 if(assets.filter(a=>a.kind==="executed_contract").length>1 || assets.filter(a=>["order_dashboard","platform_order_export"].includes(a.kind)).length>1)throw Error("Select one contract and one order proof per revision");
 const signature=assets.find(a=>a.id===branding?.signature_asset_id&&a.kind==="signature");
 const template=fields.contract_path==="generated"?checked<any>(await db.from("predeposit_agreement_templates").select("*").eq("version",fields.agreement_version).eq("status","approved").maybeSingle()):null;
 if(fields.contract_path==="generated" && (!template || !signature || !fields.signature_consent || !branding?.signer_name))throw Error("Select an approved agreement and authorize your saved signature");
 const invoice:Invoice={...fields,id:crypto.randomUUID(),revision:version,merchant:{legal_name:accounts.merchant.legal_name,incorporation_country:accounts.merchant.incorporation_country},
  documents:assets.filter(a=>!["logo","signature"].includes(a.kind)).map(a=>({id:a.id,kind:a.kind,sha256:a.sha256})),
  agreement:{version:template?.version||"",terms_sha256:template?await sha256(template.body):"",signature_sha256:signature?.sha256||"",signed_by:branding?.signer_name||"",signed_at:new Date().toISOString(),signature_consent:fields.signature_consent}};
 const total=invoiceTotalMinor(invoice.items);if(total===null)throw Error("Invoice amount is invalid");
 if(invoice.currency==="GBP"&&(invoice.buyer.type!=="company"||invoice.remitter.type!=="company"))throw Error("GBP invoices require a corporate buyer and corporate remitter");
 if(template){
  const logo=assets.find(a=>a.id===branding?.logo_asset_id);
  const pdf=await renderInvoiceDocument({...await loadPdfStyleAssets(db),invoice,invoiceNumber:draft.invoice_number,fontBytes:await fontBytes(db),templateBody:template.body,agreementOnly:true,
   signature:await loadAssetBytes(db,signature),...(logo?{logo:await loadAssetBytes(db,logo)}:{})});
  const generated=await saveAsset(db,owner,"signed_agreement",pdf,"application/pdf",true);assets.push(generated);invoice.documents.push({id:generated.id,kind:"signed_agreement",sha256:generated.sha256});
 }
 const context=await contextFor(db,owner,invoice,accounts,policy);
 const contextRecord={...context,total_minor:total,config_sha256:await sha256(canonicalJson(policy.config)),provider_customer_id:accounts.customer_id,branding:branding?{logo_asset_id:branding.logo_asset_id,signature_asset_id:branding.signature_asset_id}:{}};
 const persisted=checked<any>(await db.rpc("submit_predeposit_draft",{p_owner:owner,p_draft:draftId,p_version:version,p_invoice:invoice,p_context:contextRecord,
  p_sha:await sha256(canonicalJson(invoice)),p_buyer_hash:await sha256(normalizedLegalName(invoice.buyer.legal_name)+"|"+invoice.buyer.country+"|"+invoice.buyer.tax_id),
  p_documents:assets.filter(a=>!["logo","signature"].includes(a.kind)),p_provider:accounts.provider}));
 return {id:persisted.id,status:persisted.status,revision:persisted.revision};
}
export async function invoiceDossier(db:any,row:any,context:ReviewContext,bank?:any){
 const assets=checked<any[]>(await db.from("predeposit_assets").select("*").eq("owner_user_id",row.owner_user_id).in("id",row.payload.documents.map((d:any)=>d.id)));
 if(assets.some(a=>a.scan_status==="rejected"||a.verification_status==="rejected"))throw Error("Evidence has been rejected; submit a corrected revision");
 const included=bank?assets.filter(a=>["signed_agreement","executed_contract"].includes(a.kind)):assets;
 const attachments=[];for(const a of included)attachments.push({name:a.kind+" - "+a.id,mime:a.mime_type,bytes:await loadAssetBytes(db,a),sha256:a.sha256});
 const branding=row.review_context.branding;
 let logo:Uint8Array|undefined;
 if(branding?.logo_asset_id){const a=checked<any>(await db.from("predeposit_assets").select("*").eq("id",branding.logo_asset_id).eq("owner_user_id",row.owner_user_id).single());logo=await loadAssetBytes(db,a);}
 const bytes=await renderInvoiceDocument({...await loadPdfStyleAssets(db),invoice:row.payload,invoiceNumber:row.invoice_number,fontBytes:await fontBytes(db),attachments,logo,bank,approved:!!bank||row.assessment?.status==="approved",...(!bank?{complianceReview:{assessment:row.assessment||{status:"screening"},recorded_at:new Date().toISOString()}}:{})});
 const hash=await sha256(bytes),path=row.owner_user_id+"/dossiers/"+row.id+"/"+crypto.randomUUID()+".pdf";
 checked(await db.storage.from(BUCKET).upload(path,bytes,{contentType:"application/pdf",upsert:false}));
 return {path,sha256:hash};
}
