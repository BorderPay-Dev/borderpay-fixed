declare const EdgeRuntime: {waitUntil(promise:Promise<unknown>):void};
import {createClient} from "jsr:@supabase/supabase-js@2";
import {processInvoice} from "../_shared/predeposit-worker.ts";
import {sha256} from "../_shared/predeposit-policy.ts";
Deno.serve(async req=>{
 const expected=Deno.env.get("PREDEPOSIT_WORKER_TOKEN")||"";
 const received=req.headers.get("x-predeposit-worker-token")||"";
 if(req.method!=="POST"||expected.length<32||await sha256(received)!==await sha256(expected))return new Response("Unauthorized",{status:401});
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const {data,error}=await db.from("predeposit_invoices").select("id").in("status",["queued","screening"]).or("lease_until.is.null,lease_until.lt."+new Date().toISOString()).order("created_at").limit(4);
 if(error)return new Response("Queue unavailable",{status:503});
 EdgeRuntime.waitUntil(Promise.all((data||[]).map(row=>processInvoice(db,row.id))));
 return Response.json({accepted:(data||[]).length},{status:202});
});