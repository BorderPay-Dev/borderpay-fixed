// subscription-upgrade — retired.
//
// BorderPay production no longer uses paid plans, activation fees, first-fund
// gates, or subscription upgrades. This compatibility endpoint fails closed for
// stale clients and never touches billing, ledger, wallet, or subscription rows.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ success: false, code: "method_not_allowed", error: "POST only" }, 405);
  }
  return json({
    success: false,
    code: "subscriptions_retired",
    error: "BorderPay no longer uses paid plans, activation fees, or subscription upgrades.",
  }, 410);
});
