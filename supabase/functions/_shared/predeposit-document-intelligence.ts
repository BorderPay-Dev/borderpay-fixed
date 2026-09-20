/**
 * Azure Document Intelligence layout OCR transport.
 * Layout OCR does not establish document authenticity or semantic order matching.
 * The service must bind results to the input SHA-256 and preserve field-level confidence.
 */
import { sha256 } from "./predeposit-policy.ts";
export type DocumentIntelligenceConfig={endpoint:string;apiKey:string;apiVersion?:string};
export type OcrJob={status:"pending";operation_url:string;document_sha256:string}|{status:"failed";code:string};
export type OcrResult={status:"pending"}|{status:"failed";code:string}|{
 status:"succeeded";document_sha256:string;content:string;
 pages:{page_number:number;words:{content:string;confidence:number|null}[]}[];
};
function endpoint(config:DocumentIntelligenceConfig):URL{
 const url=new URL(config.endpoint);
 if(url.protocol!=="https:" || url.username || url.password || url.port
  || !/(^|\.)(cognitiveservices\.azure\.com|api\.cognitive\.microsoft\.com|services\.ai\.azure\.com)$/.test(url.hostname))throw Error("Unsupported OCR endpoint");
 return url;
}
function operation(config:DocumentIntelligenceConfig,value:string):URL{
 const origin=endpoint(config);const url=new URL(value);
 if(url.origin!==origin.origin || url.username || url.password || !url.pathname.startsWith("/documentintelligence/documentModels/prebuilt-layout/analyzeResults/"))throw Error("Invalid OCR operation URL");
 return url;
}
export function supportedEvidenceBytes(bytes:Uint8Array,mime:string):boolean{
 if(!bytes.length || bytes.length>20*1024*1024)return false;
 if(mime==="application/pdf")return new TextDecoder().decode(bytes.slice(0,5))==="%PDF-";
 if(mime==="image/png")return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(mime==="image/jpeg")return bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
 return false;
}
export async function startDocumentOcr(bytes:Uint8Array,mime:string,config:DocumentIntelligenceConfig,fetcher:typeof fetch=fetch):Promise<OcrJob>{
 if(!supportedEvidenceBytes(bytes,mime))return {status:"failed",code:"invalid_evidence_file"};
 try{
  if(!config.apiKey)return {status:"failed",code:"ocr_not_configured"};
  const url=endpoint(config);url.pathname="/documentintelligence/documentModels/prebuilt-layout:analyze";
  url.search="";url.searchParams.set("api-version",config.apiVersion||"2024-11-30");url.hash="";
  const response=await fetcher(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),
   headers:{"Ocp-Apim-Subscription-Key":config.apiKey,"Content-Type":mime},body:bytes as BodyInit});
  if(response.status!==202)return {status:"failed",code:"ocr_submit_failed"};
  const location=response.headers.get("operation-location");if(!location)return {status:"failed",code:"ocr_operation_missing"};
  return {status:"pending",operation_url:operation(config,location).toString(),document_sha256:await sha256(bytes)};
 }catch{return {status:"failed",code:"ocr_unavailable"};}
}
export async function pollDocumentOcr(job:Extract<OcrJob,{status:"pending"}>,config:DocumentIntelligenceConfig,fetcher:typeof fetch=fetch):Promise<OcrResult>{
 try{
  if(!config.apiKey || !/^[a-f0-9]{64}$/.test(job.document_sha256))return {status:"failed",code:"ocr_not_configured"};
  const url=operation(config,job.operation_url);
  const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(20000),headers:{"Ocp-Apim-Subscription-Key":config.apiKey}});
  if(!response.ok)return {status:"failed",code:"ocr_poll_failed"};
  const result=await response.json();
  if(["notStarted","running"].includes(result.status))return {status:"pending"};
  if(result.status!=="succeeded" || typeof result.analyzeResult?.content!=="string" || !Array.isArray(result.analyzeResult?.pages))return {status:"failed",code:"ocr_extraction_failed"};
  if(result.analyzeResult.content.length>200000 || result.analyzeResult.pages.length>100)return {status:"failed",code:"ocr_document_too_large"};
  const pages=result.analyzeResult.pages.map((p:any)=>({page_number:p.pageNumber,words:(Array.isArray(p.words)?p.words:[]).map((w:any)=>({
   content:typeof w.content==="string"?w.content:"",
   confidence:typeof w.confidence==="number" && Number.isFinite(w.confidence) && w.confidence>=0 && w.confidence<=1?w.confidence:null
  }))}));
  return {status:"succeeded",document_sha256:job.document_sha256,content:result.analyzeResult.content,pages};
 }catch{return {status:"failed",code:"ocr_unavailable"};}
}
