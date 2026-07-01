import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveGetCollection, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";
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

function normStatus(input: unknown): "pending" | "completed" | "failed" {
  const s = String(input || "").trim().toLowerCase();
  if (["successful", "success", "completed", "paid", "succeeded"].includes(s)) return "completed";
  if (["failed", "cancelled", "canceled", "reversed", "declined", "error"].includes(s)) return "failed";
  return "pending";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave collection status endpoint is not enabled in this environment.",
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

  const collection_id = String(body?.collection_id || body?.charge_id || body?.id || "").trim();
  if (!collection_id) return json({ success: false, error: "collection_id is required" }, 400);

  const res = await flutterwaveGetCollection(collection_id);
  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to retrieve collection status");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: { capabilities: caps, collection_id },
    }, mapped.status);
  }

  const collection = (res.data || {}) as Record<string, unknown>;
  const txRef = String(collection?.tx_ref || collection?.reference || collection?.txRef || "").trim();
  const status = normStatus(collection?.status || collection?.payment_status);
  const currency = String(collection?.currency || "").toUpperCase();
  const amount = Number(collection?.amount || collection?.charged_amount || 0);
  const accountType = String(body?.account_type || "individual").toLowerCase();

  const upsertPayload: Record<string, unknown> = {
    tx_ref: txRef || collection_id,
    flutterwave_collection_id: String(collection?.id || collection_id),
    amount: Number.isFinite(amount) ? amount : null,
    currency: currency || null,
    status,
    metadata: {
      source: "flutterwave",
      account_type: accountType,
      polled: true,
    },
    raw_payload: collection,
  };

  if (accountType === "business") {
    upsertPayload.business_user_id = authData.user.id;
    upsertPayload.user_id = null;
  } else {
    upsertPayload.user_id = authData.user.id;
    upsertPayload.business_user_id = null;
  }

  await supa.from("flutterwave_collections").upsert(upsertPayload, { onConflict: "tx_ref" });

  return json({
    success: true,
    data: {
      capabilities: caps,
      collection_id,
      collection: res.data,
    },
  });
});
