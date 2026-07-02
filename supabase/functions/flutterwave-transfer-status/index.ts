import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveGetTransfer, getFlutterwaveCapabilities } from "../_shared/providers/flutterwave.ts";
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

function keepTerminalStatus(existingStatus: unknown, incomingStatus: "pending" | "completed" | "failed") {
  const current = String(existingStatus || "").toLowerCase();
  if (current === "completed" || current === "failed") return current as "completed" | "failed";
  return incomingStatus;
}

function isSafeProviderId(value: string): boolean {
  return /^[A-Za-z0-9_-]{2,120}$/.test(value);
}

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
  if (!isSafeProviderId(transferId)) return json({ success: false, error: "transfer_id format is invalid" }, 400);
  const requestedAccountType = String(body?.account_type || "individual").toLowerCase();
  if (!["individual", "business"].includes(requestedAccountType)) {
    return json({ success: false, code: "invalid_account_type", error: "account_type must be individual or business." }, 400);
  }
  let accountType: "individual" | "business" = requestedAccountType === "business" ? "business" : "individual";
  if (accountType === "business") {
    const { data: businessProfile } = await supa
      .from("business_profiles")
      .select("id,user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (!businessProfile?.id) {
      return json({ success: false, code: "business_profile_required", error: "Business profile is required for business transfer status." }, 403);
    }
  }

  const { data: ownerProbe } = await supa
    .from("flutterwave_transfers")
    .select("user_id,business_user_id")
    .eq("flutterwave_transfer_id", transferId)
    .maybeSingle();
  if (!ownerProbe) {
    return json({ success: false, code: "transfer_not_found", error: "Transfer not found for current account." }, 404);
  }
  if (ownerProbe) {
    const knownOwners = [ownerProbe.user_id, ownerProbe.business_user_id].filter(Boolean);
    if (knownOwners.length > 0 && !knownOwners.includes(authData.user.id)) {
      return json({ success: false, error: "Transfer does not belong to current user" }, 403);
    }
    if (ownerProbe.business_user_id === authData.user.id) accountType = "business";
    if (ownerProbe.user_id === authData.user.id) accountType = "individual";
  }

  const res = await flutterwaveGetTransfer(transferId);
  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to retrieve transfer status");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: { capabilities: caps, transfer_id: transferId },
    }, mapped.status);
  }

  const transfer = (res.data || {}) as Record<string, unknown>;
  const reference = String(transfer?.reference || transfer?.tx_ref || transfer?.txRef || transferId).trim();
  const status = normStatus(transfer?.status || transfer?.payment_status);
  const currency = String(transfer?.currency || "").toUpperCase();
  const amount = Number(transfer?.amount || transfer?.charged_amount || 0);
  const { data: existingProjection } = await supa
    .from("flutterwave_transfers")
    .select("status")
    .eq("reference", reference)
    .maybeSingle();
  const effectiveStatus = keepTerminalStatus(existingProjection?.status, status);

  const upsertPayload: Record<string, unknown> = {
    reference,
    flutterwave_transfer_id: String(transfer?.id || transferId),
    amount: Number.isFinite(amount) ? amount : null,
    currency: currency || null,
    status: effectiveStatus,
    metadata: {
      source: "flutterwave",
      account_type: accountType,
      polled: true,
      provider_request_id: res.requestId || null,
    },
    last_provider_status_at: new Date().toISOString(),
    raw_payload: transfer,
  };

  if (accountType === "business") {
    upsertPayload.business_user_id = authData.user.id;
    upsertPayload.user_id = null;
  } else {
    upsertPayload.user_id = authData.user.id;
    upsertPayload.business_user_id = null;
  }

  await supa.from("flutterwave_transfers").upsert(upsertPayload, { onConflict: "reference" });

  return json({
    success: true,
    data: {
      capabilities: caps,
      transfer_id: transferId,
      resolved_account_type: accountType,
      provider_request_id: res.requestId || null,
      transfer: res.data,
    },
  });
});
