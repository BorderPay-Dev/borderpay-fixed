/**
 * Content Understanding GA layout adapter. OCR is evidence extraction, not approval.
 * Private bytes are sent directly; no public document URL is created.
 */
import { sha256 } from "./predeposit-policy.ts";
import { supportedEvidenceBytes, type OcrJob, type OcrResult } from "./predeposit-document-intelligence.ts";
export type ContentUnderstandingConfig={endpoint:string;apiKey:string};
const VERSION="2025-11-01";
function endpoint(config:ContentUnderstandingConfig):URL{
 const url=new URL(config.endpoint);
 if(url.protocol!=="https:"||url.username||url.password||url.port||
  !/^[a-z0-9-]+\.(cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/.test(url.hostname))throw Error("Unsupported Content Understanding endpoint");
 // Require the resource root, never an Azure OpenAI deployment or Foundry project URL.
 if(!["","/"].includes(url.pathname)||url.search||url.hash)throw Error("Resource endpoint required");
 return url;
}
function operation(config:ContentUnderstandingConfig,value:string):URL{
 const base=endpoint(config),url=new URL(value);
 if(url.origin!==base.origin||url.username||url.password||url.hash||
 !/^\/contentunderstanding\/analyzerResults\/[a-zA-Z0-9-]+$/.test(url.pathname)||
 url.searchParams.get("api-version")!==VERSION)throw Error("Invalid OCR operation URL");
 return url;
}
function base64(bytes:Uint8Array):string{
 let value="";for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(value);
}
export async function startContentUnderstandingOcr(bytes:Uint8Array,mime:string,config:ContentUnderstandingConfig,fetcher:typeof fetch=fetch):Promise<OcrJob>{
 if(!supportedEvidenceBytes(bytes,mime))return {status:"failed",code:"invalid_evidence_file"};
 try{
  if(!config.apiKey)return {status:"failed",code:"ocr_not_configured"};
  const url=endpoint(config);url.pathname="/contentunderstanding/analyzers/prebuilt-layout:analyze";
  url.searchParams.set("api-version",VERSION);
  // Do not silently use Azure's global-processing default for commercial documents.
  url.searchParams.set("processingLocation","geography");
  const response=await fetcher(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),
   headers:{"Ocp-Apim-Subscription-Key":config.apiKey,"Content-Type":"application/json"},
   body:JSON.stringify({inputs:[{data:base64(bytes),mimeType:mime}]})});
  if(response.status!==202)return {status:"failed",code:"ocr_submit_failed"};
  const location=response.headers.get("operation-location");
  if(!location)return {status:"failed",code:"ocr_operation_missing"};
  return {status:"pending",operation_url:operation(config,location).toString(),document_sha256:await sha256(bytes)};
 }catch{return {status:"failed",code:"ocr_unavailable"};}
}
export async function pollContentUnderstandingOcr(job:Extract<OcrJob,{status:"pending"}>,config:ContentUnderstandingConfig,fetcher:typeof fetch=fetch):Promise<OcrResult>{
 try{
  if(!config.apiKey||!/^[a-f0-9]{64}$/.test(job.document_sha256))return {status:"failed",code:"ocr_not_configured"};
  const response=await fetcher(operation(config,job.operation_url),{redirect:"error",signal:AbortSignal.timeout(20000),headers:{"Ocp-Apim-Subscription-Key":config.apiKey}});
  if(!response.ok)return {status:"failed",code:"ocr_poll_failed"};
  const body=await response.json();
  if(["NotStarted","Running"].includes(body.status))return {status:"pending"};
  if(body.status!=="Succeeded"||body.result?.analyzerId!=="prebuilt-layout"||body.result?.apiVersion!==VERSION)
   return {status:"failed",code:"ocr_extraction_failed"};
  const contents=body.result.contents;
  // A single submitted document must not be replaced by an unrelated multimodal result.
  if(!Array.isArray(contents)||contents.length!==1||contents[0]?.kind!=="document")return {status:"failed",code:"ocr_extraction_failed"};
  const document=contents[0];
  if(typeof document.markdown!=="string"||!document.markdown.trim()||!Array.isArray(document.pages)||!document.pages.length)
   return {status:"failed",code:"ocr_extraction_failed"};
  if(document.markdown.length>200000||document.pages.length>100)return {status:"failed",code:"ocr_document_too_large"};
  const pages:Extract<OcrResult,{status:"succeeded"}>["pages"]=[];
  const seen=new Set<number>();let wordCount=0;
  for(const p of document.pages){
   if(!Number.isSafeInteger(p.pageNumber)||p.pageNumber<1||seen.has(p.pageNumber)||!Array.isArray(p.words))return {status:"failed",code:"ocr_details_missing"};
   seen.add(p.pageNumber);wordCount+=p.words.length;
   if(wordCount>100000)return {status:"failed",code:"ocr_document_too_large"};
   const words=p.words.map((w:any)=>({
    content:typeof w?.content==="string"?w.content:"",
    confidence:typeof w?.confidence==="number"&&Number.isFinite(w.confidence)&&w.confidence>=0&&w.confidence<=1?w.confidence:null
   }));
   pages.push({page_number:p.pageNumber,words});
  }
  if(!wordCount)return {status:"failed",code:"ocr_details_missing"};
  return {status:"succeeded",document_sha256:job.document_sha256,content:document.markdown,pages};
 }catch{return {status:"failed",code:"ocr_unavailable"};}
}
