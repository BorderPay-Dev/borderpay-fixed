// subscription-current — retired.
//
// BorderPay production no longer uses paid plans, activation fees, first-fund
// gates, or subscription rows for money movement. Keep this function deployed
// as a compatibility no-op for stale clients, but never read billing tables.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);
  return json({
    success: true,
    code: "subscriptions_retired",
    data: {
      subscription: null,
      recent_invoices: [],
    },
  });
});
