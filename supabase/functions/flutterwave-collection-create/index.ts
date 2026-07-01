import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveCreateCollection, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";
import { mapFlutterwaveErrorResponse } from "../_shared/providers/flutterwave-error-response.ts";

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

function toPositiveNumber(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave collection rails are not enabled in this environment.",
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

  const amount = toPositiveNumber(body?.amount);
  const currency = String(body?.currency || "").trim().toUpperCase();
  const tx_ref = String(body?.tx_ref || body?.reference || "").trim();
  if (!amount) return json({ success: false, error: "amount must be > 0" }, 400);
  if (!currency) return json({ success: false, error: "currency is required" }, 400);
  if (!tx_ref) return json({ success: false, error: "tx_ref is required" }, 400);

  const res = await flutterwaveCreateCollection({
    amount,
    currency,
    tx_ref,
    ...(body?.payment_options ? { payment_options: String(body.payment_options) } : {}),
    ...(body?.redirect_url ? { redirect_url: String(body.redirect_url) } : {}),
    ...(typeof body?.customer === "object" && body?.customer !== null ? { customer: body.customer } : {}),
    ...(typeof body?.customizations === "object" && body?.customizations !== null ? { customizations: body.customizations } : {}),
    ...(typeof body?.meta === "object" && body?.meta !== null ? { meta: body.meta } : {}),
  });

  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to create collection");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: { capabilities: caps },
    }, mapped.status);
  }

  return json({
    success: true,
    data: {
      capabilities: caps,
      collection: res.data,
    },
  });
});

