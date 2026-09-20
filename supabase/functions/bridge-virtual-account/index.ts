// Instruction gate around the exact deployed v384 provisioning graph.
// Do not replace production-v384 with older shared modules without reconciliation.
import {createClient} from "jsr:@supabase/supabase-js@2";
import {legacyVirtualAccountHandler} from "./production-v384/bridge-virtual-account/index.js";
import {withInvoiceInstructionBoundary} from "../_shared/predeposit-http-boundary.ts";
import {requiresInvoiceInstructions} from "../_shared/predeposit-access.ts";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const BLOCKED_ACCOUNT_STATUSES=new Set(["frozen","paused","suspended","offboarded","deactivated","closed"]);
const isBlockedAccountStatus=(status:unknown)=>BLOCKED_ACCOUNT_STATUSES.has(String(status||"").trim().toLowerCase());
Deno.serve(req=>withInvoiceInstructionBoundary(req,{
 authenticate:async request=>{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return null;
  const {data,error}=await db.auth.getUser(token);return error?null:data.user?.id||null;
 },
 checkAccess:async userId=>{
  const {data:accessProfile,error:accessProfileError}=await db.from("user_profiles").select("account_status,bridge_account_status").eq("id",userId).maybeSingle();
  if(accessProfileError||!accessProfile)throw Error("Account access status unavailable");
  if(isBlockedAccountStatus(accessProfile.account_status)||isBlockedAccountStatus(accessProfile.bridge_account_status)){
   return Response.json({success:false,code:"account_frozen",error:"Virtual account access is unavailable while this account is restricted."},{status:423,headers:{"Access-Control-Allow-Origin":"*","Cache-Control":"no-store"}});
  }
  return null;
 },
 required:userId=>requiresInvoiceInstructions(db,userId),
 handle:legacyVirtualAccountHandler,
}));
