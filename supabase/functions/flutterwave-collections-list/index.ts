import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveListCollections, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave collection list endpoint is not enabled in this environment.",
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

  const res = await flutterwaveListCollections({
    ...(body?.tx_ref ? { tx_ref: String(body.tx_ref) } : {}),
    ...(body?.status ? { status: String(body.status) } : {}),
    ...(body?.from ? { from: String(body.from) } : {}),
    ...(body?.to ? { to: String(body.to) } : {}),
    ...(Number.isFinite(Number(body?.page)) ? { page: Number(body.page) } : {}),
    ...(Number.isFinite(Number(body?.limit)) ? { limit: Number(body.limit) } : {}),
  });

  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to list collections");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: { capabilities: caps },
    }, mapped.status);
  }

  const accountType = String(body?.account_type || "individual").toLowerCase();
  const ownerColumn = accountType === "business" ? "business_user_id" : "user_id";
  const { data: projectedCollections } = await supa
    .from("flutterwave_collections")
    .select("tx_ref,flutterwave_collection_id,amount,currency,status,metadata,created_at,updated_at")
    .eq(ownerColumn, authData.user.id)
    .order("updated_at", { ascending: false })
    .limit(Number.isFinite(Number(body?.limit)) ? Math.max(1, Math.min(100, Number(body.limit))) : 50);

  return json({
    success: true,
    data: {
      capabilities: caps,
      collections: res.data,
      projected_collections: projectedCollections || [],
    },
  });
});
