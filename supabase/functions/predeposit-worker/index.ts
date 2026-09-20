declare const EdgeRuntime: {waitUntil(promise:Promise<unknown>):void};
import {createClient} from "jsr:@supabase/supabase-js@2";
import {processInvoice} from "../_shared/predeposit-worker.ts";
import {runPredepositSelfTest} from "../_shared/predeposit-self-test.ts";
Deno.serve(async req=>{

 const received=req.headers.get("x-predeposit-worker-token")||"";
 if(req.method!=="POST"||received.length<32||received.length>128)return new Response("Unauthorized",{status:401});
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const auth=await db.rpc("authorize_predeposit_worker",{p_token:received});
 if(auth.error||auth.data!==true)return new Response("Unauthorized",{status:401});
 if(new URL(req.url).searchParams.get("action")==="self_test"){
  try{return Response.json(await runPredepositSelfTest(db),{headers:{"Cache-Control":"no-store"}});}
  catch{return Response.json({synthetic:true,error:"self_test_unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
 }
 const {data,error}=await db.from("predeposit_invoices").select("id").in("status",["queued","screening"]).or("lease_until.is.null,lease_until.lt."+new Date().toISOString()).order("created_at").limit(4);
 if(error)return new Response("Queue unavailable",{status:503});
 EdgeRuntime.waitUntil(Promise.all((data||[]).map(row=>processInvoice(db,row.id))));
 const reconciliation=await db.rpc("reconcile_predeposit_bridge_events",{p_limit:50});
 if(reconciliation.error)return Response.json({accepted:(data||[]).length,error:"Deposit reconciliation unavailable"},{status:503});
 return Response.json({accepted:(data||[]).length,reconciliation:reconciliation.data},{status:202});
});