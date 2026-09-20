import assert from "node:assert/strict";
Deno.env.set("SUPABASE_URL","https://compat-test.invalid");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-only");
const {legacyVirtualAccountHandler}=await import("../supabase/functions/bridge-virtual-account/production-v384/bridge-virtual-account/index.js");
Deno.test("preserved production VA handler retains method, CORS and missing-auth behavior without provider calls",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error("Unexpected network request");};
 try{
  const options=await legacyVirtualAccountHandler(new Request("https://compat-test.invalid",{method:"OPTIONS"}));
  assert.equal(options.status,200);assert.equal(options.headers.get("Access-Control-Allow-Origin"),"*");
  assert.equal((await legacyVirtualAccountHandler(new Request("https://compat-test.invalid"))).status,405);
  const unauth=await legacyVirtualAccountHandler(new Request("https://compat-test.invalid",{method:"POST",body:"{}"}));
  assert.equal(unauth.status,401);assert.equal((await unauth.json()).code,"missing_bearer_token");assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});