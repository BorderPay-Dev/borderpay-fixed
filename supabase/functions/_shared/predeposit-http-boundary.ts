import {redactBankCoordinates} from "./predeposit-access.ts";
type Dependencies={
 authenticate:(req:Request)=>Promise<string|null>;
 checkAccess:(userId:string)=>Promise<Response|null>;
 required:(userId:string)=>Promise<boolean>;
 handle:(req:Request)=>Promise<Response>;
};
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Content-Type":"application/json","Cache-Control":"no-store"};
function unavailable(){return new Response(JSON.stringify({success:false,code:"receiving_instruction_policy_unavailable",error:"Receiving details are temporarily unavailable. Refresh before trying again."}),{status:503,headers});}
/** Wraps the preserved provider handler without changing account provisioning or SCA. */
export async function withInvoiceInstructionBoundary(req:Request,deps:Dependencies):Promise<Response>{
 if(req.method==="OPTIONS"||req.method!=="POST")return deps.handle(req);
 try{
  const userId=await deps.authenticate(req);
  if(!userId)return new Response(JSON.stringify({success:false,code:"invalid_auth_token",error:"Authentication required"}),{status:401,headers});
  const denied=await deps.checkAccess(userId);if(denied)return denied;
  // Policy failure must stop before any provider call or account creation.
  const before=await deps.required(userId);
  const response=await deps.handle(req);
  // Recheck to cover enforcement becoming active while the request was running.
  const required=await deps.required(userId);
  if(!before&&!required){const safeHeaders=new Headers(response.headers);safeHeaders.set("Cache-Control","no-store");return new Response(response.body,{status:response.status,statusText:response.statusText,headers:safeHeaders});}
  let body:unknown;try{body=await response.json();}catch{return unavailable();}
  const safeHeaders=new Headers(response.headers);
  safeHeaders.delete("Content-Length");safeHeaders.delete("ETag");safeHeaders.set("Content-Type","application/json");safeHeaders.set("Cache-Control","no-store");
  return new Response(JSON.stringify(redactBankCoordinates(body)),{status:response.status,statusText:response.statusText,headers:safeHeaders});
 }catch{return unavailable();}
}
