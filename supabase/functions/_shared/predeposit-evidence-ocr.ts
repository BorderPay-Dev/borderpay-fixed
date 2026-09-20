import { startDocumentOcr, pollDocumentOcr, type OcrJob } from "./predeposit-document-intelligence.ts";
import { startContentUnderstandingOcr, pollContentUnderstandingOcr } from "./predeposit-content-understanding.ts";
export type EvidenceOcrProvider="document_intelligence"|"content_understanding";
export type EvidenceOcrConfig={provider:EvidenceOcrProvider;endpoint:string;apiKey:string};
export type EvidenceOcrJob=OcrJob&{provider?:EvidenceOcrProvider};
export async function loadEvidenceOcrConfig(db:any):Promise<EvidenceOcrConfig>{
 // Read the service-role-only Vault RPC. Explicit selection cannot silently downgrade.
 const result=await db.rpc("predeposit_ocr_config");
 if(result.error)throw Error("OCR configuration unavailable");
 const saved=result.data||{};
 const provider=saved.provider??Deno.env.get("PREDEPOSIT_OCR_PROVIDER")??"document_intelligence";
 if(provider!=="document_intelligence"&&provider!=="content_understanding")throw Error("Invalid OCR provider");
 const prefix=provider==="content_understanding"?"AZURE_CONTENT_UNDERSTANDING":"AZURE_DOCUMENT_INTELLIGENCE";
 return {provider,endpoint:String(saved.endpoint||Deno.env.get(prefix+"_ENDPOINT")||""),apiKey:String(saved.apiKey||Deno.env.get(prefix+"_KEY")||"")};
}
export async function startEvidenceOcr(bytes:Uint8Array,mime:string,config:EvidenceOcrConfig,fetcher:typeof fetch=fetch):Promise<EvidenceOcrJob>{
 const job=await (config.provider==="content_understanding"?startContentUnderstandingOcr:startDocumentOcr)(bytes,mime,config,fetcher);
 return {...job,provider:config.provider};
}
export async function pollEvidenceOcr(job:Extract<EvidenceOcrJob,{status:"pending"}>,config:EvidenceOcrConfig,fetcher:typeof fetch=fetch){
 // Jobs created before provider tagging were Document Intelligence jobs.
 if((job.provider||"document_intelligence")!==config.provider)return {status:"failed" as const,code:"ocr_provider_changed"};
 return (config.provider==="content_understanding"?pollContentUnderstandingOcr:pollDocumentOcr)(job,config,fetcher);
}
