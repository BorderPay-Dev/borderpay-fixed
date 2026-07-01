import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { flutterwaveGetTransfer, getFlutterwaveCapabilities, mapFlutterwaveProviderStatus } from "../_shared/providers/flutterwave.ts";

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

const ALLOWED_DIRECTION = new Set(["payout", "receive"]);

function transferData(input: any): any {
  return input?.data && typeof input.data === "object" ? input.data : input;
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
  const reference = String(body?.reference || "").trim();
  const localTransferId = String(body?.local_transfer_id || "").trim();
  const direction = String(body?.direction || "").trim().toLowerCase();
  if (direction && !ALLOWED_DIRECTION.has(direction)) {
    return json({ success: false, error: "direction must be payout or receive" }, 400);
  }
  if (direction === "payout" && !caps.payout_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave payout rails are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }
  if (direction === "receive" && !caps.receive_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave receive rails are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }
  if (!transferId && !reference && !localTransferId) {
    return json({ success: false, error: "transfer_id, reference, or local_transfer_id is required" }, 400);
  }

  let localRecord: any = null;
  if (localTransferId) {
    let q = supa
      .from("flutterwave_transfers")
      .select("*")
      .eq("id", localTransferId)
      .eq("user_id", authData.user.id)
      .eq("source", "flutterwave");
    if (direction) q = q.eq("direction", direction);
    const { data } = await q.maybeSingle();
    localRecord = data || null;
  } else if (reference) {
    let q = supa
      .from("flutterwave_transfers")
      .select("*")
      .eq("reference", reference)
      .eq("user_id", authData.user.id)
      .eq("source", "flutterwave");
    if (direction) q = q.eq("direction", direction);
    const { data } = await q.maybeSingle();
    localRecord = data || null;
  } else if (transferId) {
    let q = supa
      .from("flutterwave_transfers")
      .select("*")
      .eq("provider_transfer_id", transferId)
      .eq("user_id", authData.user.id)
      .eq("source", "flutterwave");
    if (direction) q = q.eq("direction", direction);
    const { data } = await q.maybeSingle();
    localRecord = data || null;
  }

  if (!localRecord) {
    return json({ success: false, error: "Transfer record not found for this account." }, 404);
  }

  const providerTransferId = transferId || String(localRecord.provider_transfer_id || "").trim();
  if (!providerTransferId) {
    return json({
      success: false,
      error: "Transfer has no provider id yet. Retry after create webhook sync.",
      data: { local_transfer_id: localRecord.id, reference: localRecord.reference },
    }, 409);
  }

  const res = await flutterwaveGetTransfer(providerTransferId);
  if (!res.ok) {
    const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
    await supa.from("flutterwave_transfers")
      .update({
        last_error: res.error || "status_fetch_failed",
        provider_response: res.data ?? {},
        provider_request_id: res.requestId || null,
        provider_http_status: Number.isFinite(res.status) ? res.status : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", localRecord.id)
      .eq("user_id", authData.user.id)
      .eq("source", "flutterwave");
    return json({
      success: false,
      code: isIpGuard ? "static_ip_not_ready" : "upstream_error",
      error: isIpGuard
        ? "Flutterwave money movement is blocked until static egress IP is allowlisted and marked ready."
        : (res.error || "Failed to retrieve transfer status"),
      data: { capabilities: caps, transfer_id: providerTransferId, local_transfer_id: localRecord.id },
    }, isIpGuard ? 503 : 502);
  }

  const rData = transferData(res.data);
  const providerStatus = String(rData?.status || "").trim() || null;
  const mappedStatus = mapFlutterwaveProviderStatus(providerStatus);
  await supa.from("flutterwave_transfers")
    .update({
      provider_transfer_id: providerTransferId,
      status: mappedStatus,
      provider_status: providerStatus,
      provider_response: res.data ?? {},
      provider_request_id: res.requestId || null,
      provider_http_status: Number.isFinite(res.status) ? res.status : null,
      last_error: null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", localRecord.id)
    .eq("user_id", authData.user.id)
    .eq("source", "flutterwave");

  return json({
    success: true,
      data: {
        endpoint: "flutterwave-transfer-status",
        status_scope: "transfer",
        response_contract_version: 1,
        contract_generated_at: new Date().toISOString(),
        provider: "flutterwave",
        capabilities: caps,
        local_transfer_id: localRecord.id,
        direction: localRecord.direction || null,
        source: localRecord.source || "flutterwave",
        source_locked_to_flutterwave: true,
        channel: localRecord.channel || null,
        reference: localRecord.reference,
        transfer_id: providerTransferId,
        status: mappedStatus,
        provider_status: providerStatus,
        status_source: providerStatus ? "provider" : "local",
        transfer: res.data,
      },
  });
});
