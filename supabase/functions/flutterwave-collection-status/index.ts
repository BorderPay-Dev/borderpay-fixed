import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveGetCharge,
  getFlutterwaveCapabilities,
  getFlutterwaveNetworkGuard,
  mapFlutterwaveProviderStatus,
} from "../_shared/providers/flutterwave.ts";

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
      error: "Flutterwave collection rails are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  const networkGuard = getFlutterwaveNetworkGuard("read");
  if (!networkGuard.allowed) {
    return json({
      success: false,
      code: networkGuard.code,
      error: networkGuard.message,
      data: { capabilities: caps, network_guard: networkGuard },
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

  const reference = String(body?.reference || "").trim();
  const providerId = String(body?.provider_transfer_id || "").trim();
  const localTransferId = String(body?.local_transfer_id || "").trim();
  if (!reference && !providerId && !localTransferId) {
    return json({ success: false, error: "reference, provider_transfer_id, or local_transfer_id is required" }, 400);
  }

  let row: any = null;
  if (localTransferId) {
    const { data } = await supa
      .from("flutterwave_transfers")
      .select("*")
      .eq("id", localTransferId)
      .eq("user_id", authData.user.id)
      .eq("direction", "receive")
      .eq("source", "flutterwave")
      .maybeSingle();
    row = data || null;
  } else if (providerId) {
    const { data } = await supa
      .from("flutterwave_transfers")
      .select("*")
      .eq("provider_transfer_id", providerId)
      .eq("user_id", authData.user.id)
      .eq("direction", "receive")
      .eq("source", "flutterwave")
      .maybeSingle();
    row = data || null;
  } else {
    const { data } = await supa
      .from("flutterwave_transfers")
      .select("*")
      .eq("reference", reference)
      .eq("user_id", authData.user.id)
      .eq("direction", "receive")
      .eq("source", "flutterwave")
      .maybeSingle();
    row = data || null;
  }

  if (!row) {
    return json({ success: false, error: "Collection record not found for current user" }, 404);
  }
  const chargeId = String(row.provider_transfer_id || "").trim();
  if (!chargeId) {
    return json({
      success: false,
      error: "Collection exists locally but provider id is not available yet. Try again shortly.",
      data: { reference: row.reference },
    }, 409);
  }

  const res = await flutterwaveGetCharge(chargeId);
  if (!res.ok) {
    const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
    await supa.from("flutterwave_transfers").update({
      provider_response: res.data ?? {},
      provider_request_id: res.requestId || null,
      provider_http_status: Number.isFinite(res.status) ? res.status : null,
      last_error: isIpGuard ? "static_ip_not_ready" : (res.error || "collection_status_failed"),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("direction", "receive").eq("source", "flutterwave");

    return json({
      success: false,
      code: isIpGuard ? "static_ip_not_ready" : "upstream_error",
      error: isIpGuard
        ? "Flutterwave money movement is blocked until static egress IP is allowlisted and marked ready."
        : (res.error || "Failed to fetch collection status"),
      data: { reference: row.reference, provider_transfer_id: chargeId },
    }, isIpGuard ? 503 : 502);
  }

  const rData: any = (res.data && typeof res.data === "object" && (res.data as any).data)
    ? (res.data as any).data
    : res.data;
  const providerStatus = String(rData?.status || "").trim();
  const mappedStatus = mapFlutterwaveProviderStatus(providerStatus);

  await supa.from("flutterwave_transfers").update({
    status: mappedStatus,
    provider_status: providerStatus || null,
    provider_response: res.data ?? {},
    provider_request_id: res.requestId || null,
    provider_http_status: Number.isFinite(res.status) ? res.status : null,
    last_error: null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("direction", "receive").eq("source", "flutterwave");

  return json({
    success: true,
    data: {
      status_scope: "collection",
      response_contract_version: 1,
      provider: "flutterwave",
      capabilities: caps,
      local_transfer_id: row.id,
      direction: row.direction || "receive",
      source: row.source || "flutterwave",
      channel: row.channel || null,
      reference: row.reference,
      provider_transfer_id: chargeId,
      status: mappedStatus,
      provider_status: providerStatus || null,
      collection: res.data,
    },
  });
});
