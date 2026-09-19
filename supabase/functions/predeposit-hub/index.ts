declare const EdgeRuntime: {waitUntil(promise:Promise<unknown>):void};
import {createClient} from "jsr:@supabase/supabase-js@2";
import {checked,loadPolicy,saveAsset,submitInvoice,loadAssetBytes,invoiceDossier,BUCKET} from "../_shared/predeposit-runtime.ts";
import {loadInvoiceAccounts} from "../_shared/predeposit-accounts.ts";
import {parseDraft,EVIDENCE_KINDS} from "../_shared/predeposit-input.ts";
import {manualEvidencePatch} from "../_shared/predeposit-manual.ts";
import {processInvoice,buildAssessment} from "../_shared/predeposit-worker.ts";
import {generateBankPaymentInstructions} from "../_shared/predeposit-payment-instructions.ts";
import {sha256,canonicalJson,evaluateInvoice,assessedDigest,type ReviewContext} from "../_shared/predeposit-policy.ts";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const uuid=(value:unknown)=>{const s=String(value||"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s))throw Error("Invalid record reference");return s;};
const launch=(id:string)=>EdgeRuntime.waitUntil(processInvoice(db,id));
async function ownInvoice(id:string,owner:string){return checked<any>(await db.from("predeposit_invoices").select("*").eq("id",id).eq("owner_user_id",owner).single());}
async function readLimited(req:Request,max:number){
 if(Number(req.headers.get("content-length")||0)>max)throw Error("Request is too large");
 const reader=req.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw Error("Request is too large");}chunks.push(r.value);}}
 finally{reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});if(req.method!=="POST")return reply({success:false,error:"POST required"},405);
 try{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return reply({success:false,error:"Sign in to continue"},401);
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user)return reply({success:false,error:"Sign in to continue"},401);
  const owner=auth.user.id;
  const admin=checked<any>(await db.from("admin_users").select("role").eq("user_id",owner).maybeSingle());
  const canReview=["ADMIN_SUPER","SUPER_ADMIN","ADMIN","COMPLIANCE","ADMIN_COMPLIANCE"].includes(String(admin?.role||"").toUpperCase());
  const profile=checked<any>(await db.from("user_profiles").select("account_type").eq("id",owner).maybeSingle());
  if(profile?.account_type!=="business"&&!canReview)return reply({success:false,error:"The invoice hub is for business accounts"},403);
  const policy=await loadPolicy(db);
  const multipart=(req.headers.get("content-type")||"").startsWith("multipart/form-data");
  if(multipart){
   if(policy.config?.hub_enabled!==true)return reply({success:false,error:"Invoicing is not enabled"},503);
   const bytes=await readLimited(req,22*1024*1024);
   const form=await new Request(req.url,{method:"POST",headers:{"content-type":req.headers.get("content-type")!},body:bytes}).formData();
   const file=form.get("file"),kind=String(form.get("kind")||"");
   if(!(file instanceof File)||!(EVIDENCE_KINDS as readonly string[]).includes(kind))throw Error("Select a supported evidence file and document type");
   const counts=await db.from("predeposit_assets").select("id",{count:"exact",head:true}).eq("owner_user_id",owner).gte("created_at",new Date(Date.now()-86400000).toISOString());
   if(counts.error||Number(counts.count)>=50)return reply({success:false,error:"Upload limit reached. Contact support for additional evidence uploads"},429);
   const a=await saveAsset(db,owner,kind,new Uint8Array(await file.arrayBuffer()),file.type);
   return reply({success:true,data:{id:a.id,kind:a.kind,sha256:a.sha256,scan_status:a.scan_status}},201);
  }
  const bytes=await readLimited(req,1024*1024);const body=JSON.parse(new TextDecoder().decode(bytes));const action=String(body.action||"");
  if(action.startsWith("admin_")){
   if(!canReview)return reply({success:false,error:"Compliance operator access required"},403);
   if(action==="admin_list"){return reply({success:true,data:checked(await db.from("predeposit_invoices").select("id,owner_user_id,invoice_number,currency,total_minor,status,created_at,assessment").in("status",["action_required","review_required","queued","screening"]).order("created_at").limit(200))});}
   if(action==="admin_get"){
    const row=checked<any>(await db.from("predeposit_invoices").select("*").eq("id",uuid(body.invoice_id)).single());
    const documents=checked(await db.from("predeposit_assets").select("id,kind,sha256,mime_type,scan_status,verification_status").eq("owner_user_id",row.owner_user_id).in("id",row.payload.documents.map((d:any)=>d.id)));
    return reply({success:true,data:{invoice:row,documents,reviews:checked(await db.from("predeposit_reviews").select("*").eq("invoice_id",row.id).order("created_at"))}});
   }
   if(action==="admin_rfi_dossier"){
    const row=checked<any>(await db.from("predeposit_invoices").select("*").eq("id",uuid(body.invoice_id)).single());
    if(!row.dossier_path||!row.dossier_sha256)throw Error("Review must complete before a dossier is available");
    const bytes=checked<Blob>(await db.storage.from(BUCKET).download(row.dossier_path));
    if(await sha256(new Uint8Array(await bytes.arrayBuffer()))!==row.dossier_sha256)throw Error("Stored evidence integrity check failed");
    checked(await db.from("predeposit_access_log").insert({invoice_id:row.id,actor_user_id:owner,action:"operator_rfi_dossier_exported",metadata:{sha256:row.dossier_sha256}}));
    const signed=checked<any>(await db.storage.from(BUCKET).createSignedUrl(row.dossier_path,60,{download:"RFI-"+row.invoice_number.replace(/[^A-Za-z0-9_-]/g,"_")+".pdf"}));
    return reply({success:true,data:{url:signed.signedUrl,sha256:row.dossier_sha256}});
   }
   if(action==="admin_document"){
    const row=checked<any>(await db.from("predeposit_invoices").select("owner_user_id,payload").eq("id",uuid(body.invoice_id)).single());
    const asset=checked<any>(await db.from("predeposit_assets").select("*").eq("id",uuid(body.asset_id)).eq("owner_user_id",row.owner_user_id).single());
    if(!row.payload.documents.some((d:any)=>d.id===asset.id&&d.sha256===asset.sha256))throw Error("Evidence is not bound to this invoice");
    await loadAssetBytes(db,asset);
    checked(await db.from("predeposit_access_log").insert({invoice_id:body.invoice_id,actor_user_id:owner,action:"operator_evidence_viewed",metadata:{asset_id:asset.id,sha256:asset.sha256}}));
    const signed=checked<any>(await db.storage.from(BUCKET).createSignedUrl(asset.storage_path,60,{download:true}));
    return reply({success:true,data:{url:signed.signedUrl}});
   }
   if(action==="admin_settings")return reply({success:true,data:{policy,templates:checked(await db.from("predeposit_agreement_templates").select("*").order("version"))}});
   const rationale=String(body.rationale||"").trim();if(rationale.length<30||rationale.length>4000)throw Error("Record a clear review rationale of 30 to 4000 characters");
   if(action==="admin_record_evidence"){
    const row=checked<any>(await db.from("predeposit_invoices").select("*").eq("id",uuid(body.invoice_id)).single());
    if(!["review_required","action_required"].includes(row.status))throw Error("Review state changed");
    const patch=manualEvidencePatch(body.kind,body.evidence,row.payload.documents);
    checked(await db.from("predeposit_evidence_verifications").insert({invoice_id:row.id,actor_user_id:owner,patch,rationale}));
    return reply({success:true});
   }
   if(action==="admin_save_template"){
    if(!["ADMIN_SUPER","SUPER_ADMIN","ADMIN"].includes(String(admin.role).toUpperCase()))return reply({success:false,error:"Super admin approval required"},403);
    const version=String(body.version||"").trim(),text=String(body.text||"").trim();if(!version||text.length<300||text.length>30000)throw Error("A versioned agreement of 300 to 30000 characters is required");
    const status=body.approved===true?"approved":"draft";
    const existing=checked<any>(await db.from("predeposit_agreement_templates").select("status").eq("version",version).maybeSingle());
    if(existing?.status==="approved")throw Error("Approved terms are immutable; create a new template version");
    checked(await db.from("predeposit_agreement_templates").upsert({version,title:String(body.title||"B2B Commercial Agreement"),body:text,status,approved_by:body.approved?owner:null,approved_at:body.approved?new Date().toISOString():null}));
    checked(await db.from("predeposit_operator_log").insert({actor_user_id:owner,action,object_id:version,details:{rationale,status,terms_sha256:await sha256(text)}}));
    return reply({success:true});
   }
   if(action==="admin_verify_asset"){
    const asset=checked<any>(await db.from("predeposit_assets").select("*").eq("id",uuid(body.asset_id)).single());
    await loadAssetBytes(db,asset);
    checked(await db.from("predeposit_assets").update({scan_status:body.accepted===true?"clean":"rejected",verification_status:body.accepted===true?"verified":"rejected",verified_by:owner,verified_at:new Date().toISOString()}).eq("id",asset.id));
    checked(await db.from("predeposit_operator_log").insert({actor_user_id:owner,action,object_id:asset.id,details:{rationale,accepted:body.accepted===true,sha256:asset.sha256}}));
    return reply({success:true});
   }
   if(action==="admin_decision"){
    const row=checked<any>(await db.from("predeposit_invoices").select("*").eq("id",uuid(body.invoice_id)).single());
    const decision=String(body.decision||"");if(!["approved","rejected","action_required"].includes(decision))throw Error("Invalid review decision");
    const result=await buildAssessment(db,row);
    if(result.pending)throw Error("Document extraction is still processing");
    const a:any=result.assessment;let dossier:any=null;
    const feedback=String(body.merchant_feedback||"").trim();if(decision==="action_required"&&feedback.length<15)throw Error("Review feedback must explain the corrections required");
    a.merchant_feedback=feedback.slice(0,4000);
    if(decision==="approved"){
     await loadInvoiceAccounts(db,row.owner_user_id);
     // Manual approval can resolve review flags, but cannot override missing data or GBP B2B.
     if(evaluateInvoice(row.payload,result.context,a.ai).status==="action_required")throw Error("Required evidence or invoice corrections are still missing");
     if(a.reasons.includes("policy_changed"))throw Error("Submit a new revision under the current policy");
     a.status="approved";a.operator_override=true;a.review_context=result.context;a.assessed_sha256=await assessedDigest(row.payload,result.context);
     dossier=await invoiceDossier(db,{...row,assessment:a},result.context);
    }else a.status=decision;
    const completed=checked(await db.rpc("complete_predeposit_review",{p_invoice:row.id,p_lease:null,p_actor:owner,p_decision:decision,p_assessment:a,p_dossier_path:dossier?.path||null,p_dossier_sha:dossier?.sha256||null,p_rationale:rationale}));
    if(!completed)throw Error("Review state changed; reload the invoice");
    return reply({success:true});
   }
   throw Error("Unsupported operator action");
  }
  if(action==="bootstrap"){
   if(policy.config?.hub_enabled!==true)return reply({success:true,data:{enabled:false,accounts:[],templates:[]}});
   let accounts:any=null,accountWarning="";
   try{accounts=await loadInvoiceAccounts(db,owner);}catch{accountWarning="Receiving accounts are unavailable. You can prepare documents; payment details require an active approved business account.";}
   return reply({success:true,data:{enabled:true,merchant:accounts?.merchant||null,accounts:(accounts?.accounts||[]).map((a:any)=>({id:a.id,currency:a.currency,status:a.status,label:a.currency+" receiving account"})),account_warning:accountWarning,
    templates:checked(await db.from("predeposit_agreement_templates").select("version,title,body,status").eq("status","approved")),
    branding:checked(await db.from("predeposit_branding").select("*").eq("owner_user_id",owner).maybeSingle()),
    assets:checked(await db.from("predeposit_assets").select("id,kind,mime_type,size_bytes,verification_status,created_at").eq("owner_user_id",owner).order("created_at",{ascending:false}).limit(200)),
    drafts:checked(await db.from("predeposit_drafts").select("*").eq("owner_user_id",owner).order("updated_at",{ascending:false}).limit(100)),
    invoices:checked(await db.from("predeposit_invoices").select("id,invoice_number,revision,currency,total_minor,status,created_at").eq("owner_user_id",owner).order("created_at",{ascending:false}).limit(100))}});
  }
  if(policy.config?.hub_enabled!==true)return reply({success:false,error:"Invoicing is not enabled"},503);
  if(action==="save_draft"){
   const payload=parseDraft(body.payload);
   if(body.id){
    const data=checked(await db.from("predeposit_drafts").update({payload,version:Number(body.version)+1,updated_at:new Date().toISOString()}).eq("id",uuid(body.id)).eq("owner_user_id",owner).eq("version",Number(body.version)).select("*").single());
    return reply({success:true,data});
   }
   const invoiceNumber=String(body.invoice_number||"").trim();if(!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,79}$/.test(invoiceNumber))throw Error("Enter an invoice reference of up to 80 letters, numbers or separators");
   return reply({success:true,data:checked(await db.from("predeposit_drafts").insert({owner_user_id:owner,invoice_number:invoiceNumber,payload}).select("*").single())},201);
  }
  if(action==="save_branding"){
   const signer=String(body.signer_name||"").trim();if(signer.length<2||signer.length>120)throw Error("Enter the authorized signer's name");
   for(const [field,kind] of [["logo_asset_id","logo"],["signature_asset_id","signature"]]){
    if(body[field]){const a=checked<any>(await db.from("predeposit_assets").select("id,kind").eq("id",uuid(body[field])).eq("owner_user_id",owner).single());if(a.kind!==kind)throw Error("Incorrect branding asset type");}
   }
   checked(await db.from("predeposit_branding").upsert({owner_user_id:owner,signer_name:signer,logo_asset_id:body.logo_asset_id||null,signature_asset_id:body.signature_asset_id||null,updated_at:new Date().toISOString()}));return reply({success:true});
  }
  if(action==="submit"){
   const counts=await db.from("predeposit_invoices").select("id",{count:"exact",head:true}).eq("owner_user_id",owner).gte("created_at",new Date(Date.now()-3600000).toISOString());
   if(counts.error||Number(counts.count)>=20)return reply({success:false,error:"Submission limit reached. Try again later"},429);
   const data=await submitInvoice(db,owner,uuid(body.draft_id),Number(body.version));launch(data.id);return reply({success:true,data},202);
  }
  if(action==="get_invoice"){
   const row=await ownInvoice(uuid(body.invoice_id),owner);
   if(["queued","screening"].includes(row.status))launch(row.id);
   return reply({success:true,data:{id:row.id,invoice_number:row.invoice_number,revision:row.revision,status:row.status,
    merchant_feedback:row.assessment?.merchant_feedback||"",reasons:row.assessment?.reasons||[],required_documents:row.assessment?.required_documents||[],findings:row.assessment?.ai?.findings||[],approval_expires_at:row.approval_expires_at}});
  }
  if(action==="download"){
   const row=await ownInvoice(uuid(body.invoice_id),owner);if(row.status!=="approved")return reply({success:false,error:"Invoice approval is required before bank details can be shared"},409);
   const userDb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
   const allowed=await userDb.rpc("can_read_bridge_financial_data",{p_user_id:owner});if(allowed.error||allowed.data!==true)return reply({success:false,error:"Complete the required security check before viewing bank details"},403);
   const accounts=await loadInvoiceAccounts(db,owner);
   if(accounts.provider!==row.provider_key||accounts.customer_id!==row.review_context.provider_customer_id)throw Error("Receiving account binding changed; submit a new invoice revision");
   if(row.assessment?.config_sha256!==await sha256(canonicalJson(policy.config)))throw Error("Review policy changed; submit a new invoice revision");
   const account=accounts.accounts.find(a=>a.id===row.payload.receiving_account_id);if(!account)throw Error("The selected receiving account is no longer active");
   const context=row.assessment.review_context as ReviewContext;
   const bank=await generateBankPaymentInstructions(owner,row.payload,context,{...row,payload_sha256:row.assessment.assessed_sha256},account);
   const dossier=await invoiceDossier(db,row,context,bank);
   checked(await db.from("predeposit_access_log").insert({invoice_id:row.id,actor_user_id:owner,action:"payment_instructions_exported",metadata:{account_id:account.id,currency:account.currency,dossier_sha256:dossier.sha256}}));
   const signed=checked<any>(await db.storage.from(BUCKET).createSignedUrl(dossier.path,60,{download:row.invoice_number.replace(/[^A-Za-z0-9_-]/g,"_")+".pdf"}));
   return reply({success:true,data:{url:signed.signedUrl,expires_in:60,sha256:dossier.sha256}});
  }
  throw Error("Unsupported invoice action");
 }catch(error){
  const raw=error instanceof Error?error.message:"Request failed";
  const safe=/^(Select |Enter |Upload |Invoice |Draft |GBP |One or more |Required |Review |Business |An approved |Account |Receiving |The selected |Complete |Submit |Document |Stored evidence |A versioned |Approved terms |Evidence |Incorrect |Request is too large|Invalid record)/.test(raw)?raw:"The invoice request could not be completed. Please refresh and try again.";
  return reply({success:false,error:safe},400);
 }
});
