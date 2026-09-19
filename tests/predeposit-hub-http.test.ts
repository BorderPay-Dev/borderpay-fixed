import assert from "node:assert/strict";
const base="https://predeposit-http-test.invalid";
const owner="11111111-1111-4111-8111-111111111111";
Deno.env.set("SUPABASE_URL",base);Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-only-not-a-credential");
let handler:(req:Request)=>Promise<Response>;
const serve=Deno.serve;Deno.serve=((fn:typeof handler)=>{handler=fn;return {};}) as typeof Deno.serve;
try{await import("../supabase/functions/predeposit-hub/index.ts");}finally{Deno.serve=serve;}
Deno.test("invoice endpoint authenticates users, honors disabled rollout and denies merchant operator actions",async()=>{
 const original=globalThis.fetch;let role="business",enabled=false;const calls:string[]=[];
 globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url);calls.push(url.pathname);
  assert.equal(url.origin,base,"No provider or OCR network call is allowed in these rejected requests");
  if(url.pathname==="/auth/v1/user")return Response.json({id:owner});
  if(url.pathname.endsWith("/admin_users"))return Response.json([]);
  if(url.pathname.endsWith("/user_profiles"))return Response.json([{account_type:role}]);
  if(url.pathname.endsWith("/predeposit_policy"))return Response.json({singleton:true,mode:"disabled",scope:"business",config:{hub_enabled:enabled}});
  throw Error("Unexpected request: "+url.pathname);
 };
 const req=(body:unknown,auth=true)=>new Request(base+"/functions/v1/predeposit-hub",{method:"POST",headers:{"Content-Type":"application/json",...(auth?{Authorization:"Bearer test-session"}:{})},body:JSON.stringify(body)});
 try{
  assert.equal((await handler(req({action:"bootstrap"},false))).status,401);
  assert.equal(calls.length,0);
  const bootstrap=await handler(req({action:"bootstrap"}));assert.equal(bootstrap.status,200);
  assert.deepEqual((await bootstrap.json()).data,{enabled:false,accounts:[],templates:[]});
  assert.equal((await handler(req({action:"save_draft",payload:{}}))).status,503);
  enabled=true;
  assert.equal((await handler(req({action:"admin_list"}))).status,403);
  assert.equal((await handler(req({action:"admin_save_template",approved:true}))).status,403);
  role="individual";assert.equal((await handler(req({action:"bootstrap"}))).status,403);
  assert.equal((await handler(new Request(base,{method:"GET"}))).status,405);
 }finally{globalThis.fetch=original;}
});
