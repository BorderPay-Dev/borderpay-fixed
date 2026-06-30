import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveGetTransfer, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";

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

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !(caps.receive_enabled || caps.payout_enabled)) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave transfer status endpoint is not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const transferId = String(body?.transfer_id || "").trim();
  if (!transferId) return json({ success: false, error: "transfer_id is required" }, 400);

  const res = await flutterwaveGetTransfer(transferId);
  if (!res.ok) {
    return json({
      success: false,
      code: "upstream_error",
      error: res.error || "Failed to retrieve transfer status",
      data: { capabilities: caps, transfer_id: transferId },
    }, 502);
  }

  return json({
    success: true,
    data: {
      capabilities: caps,
      transfer_id: transferId,
      transfer: res.data,
    },
  });
});
