import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveCreateCharge,
  getFlutterwaveCapabilities,
  getFlutterwaveNetworkGuard,
  mapFlutterwaveProviderStatus,
} from "../_shared/providers/flutterwave.ts";
import {
  evaluateProviderCorridorPolicy,
  isBridgeProfileVerified,
} from "../_shared/providers/provider-corridor-policy.ts";

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
const FLW_MIN_COLLECTION_AMOUNT = Number(Deno.env.get("FLW_MIN_COLLECTION_AMOUNT") || "1");

function toPositiveNumber(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function validReference(value: string): boolean {
  const v = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{6,120}$/.test(v);
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

  const networkGuard = getFlutterwaveNetworkGuard("money_movement");
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
  const source = String(body?.source || "").trim().toLowerCase();
  if (source && source !== "flutterwave") {
    return json({ success: false, error: "source must be flutterwave" }, 400);
  }

  const amount = toPositiveNumber(body?.amount);
  const currency = String(body?.currency || "").trim().toUpperCase();
  const destinationCountry = String(body?.destination_country || "").trim().toUpperCase();
  const destinationCurrency = String(body?.destination_currency || currency).trim().toUpperCase();
  const channel = String(body?.channel || "bank").trim().toLowerCase();
  const reference = String(body?.reference || "").trim();

  if (!amount) return json({ success: false, error: "amount must be > 0" }, 400);
  if (Number.isFinite(FLW_MIN_COLLECTION_AMOUNT) && amount < FLW_MIN_COLLECTION_AMOUNT) {
    return json({
      success: false,
      code: "amount_below_minimum",
      error: `Minimum collection amount is ${FLW_MIN_COLLECTION_AMOUNT}.`,
    }, 400);
  }
  if (!currency) return json({ success: false, error: "currency is required" }, 400);
  if (!destinationCountry) return json({ success: false, error: "destination_country is required" }, 400);
  if (!["bank", "mobile_money"].includes(channel)) {
    return json({ success: false, error: "channel must be bank or mobile_money" }, 400);
  }
  if (!reference) return json({ success: false, error: "reference is required" }, 400);
  if (!validReference(reference)) {
    return json({
      success: false,
      error: "reference must be 6-120 chars and include only letters, numbers, dot, underscore, colon, or dash",
    }, 400);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, account_type, country, full_name, bridge_kyc_status, bridge_kyb_status, bridge_account_status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (!profile) {
    return json({ success: false, code: "profile_missing", error: "User profile is missing." }, 404);
  }

  const corridorDecision = await evaluateProviderCorridorPolicy(supa, {
    provider: "flutterwave",
    direction: "receive",
    userCountry: profile.country,
    destinationCountry,
    destinationCurrency,
    channel: channel as "bank" | "mobile_money",
    bridgeVerified: isBridgeProfileVerified(profile),
  });
  if (!corridorDecision.allowed) {
    return json(
      { success: false, code: corridorDecision.code, error: corridorDecision.message },
      corridorDecision.code === "policy_lookup_failed" ? 503 : 403,
    );
  }

  const email = String((authData.user.email || body?.email || "")).trim().toLowerCase();
  const fullname = String(body?.fullname || profile.full_name || "").trim() || undefined;
  const paymentType = channel === "mobile_money" ? "mobilemoney" : "bank_transfer";

  const res = await flutterwaveCreateCharge({
    amount,
    currency,
    country: destinationCountry,
    tx_ref: reference,
    email: email || undefined,
    fullname,
    payment_type: paymentType,
    meta: {
      borderpay_user_id: authData.user.id,
      borderpay_source: "flutterwave-collection-create",
      ...(typeof body?.meta === "object" && body?.meta !== null ? body.meta : {}),
    },
  });

  if (!res.ok) {
    const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
    const isInactive = res.error === "flutterwave_account_inactive" || res.error === "flutterwave_auth_error";
    await supa.from("flutterwave_transfers").upsert({
      user_id: authData.user.id,
      direction: "receive",
      reference,
      source: "flutterwave",
      idempotency_key: reference,
      amount,
      currency,
      destination_country: destinationCountry,
      destination_currency: destinationCurrency,
      channel,
      status: "failed",
      request_payload: { amount, currency, destinationCountry, destinationCurrency, channel, reference },
      provider_response: res.data ?? {},
      provider_request_id: res.requestId || null,
      provider_http_status: Number.isFinite(res.status) ? res.status : null,
      last_error: res.error || "collection_create_failed",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,source,reference" });

    return json({
      success: false,
      code: isIpGuard
        ? "static_ip_not_ready"
        : (isInactive ? "provider_inactive" : "upstream_error"),
      error: isIpGuard
        ? "Flutterwave money movement is blocked until static egress IP is allowlisted and marked ready."
        : (isInactive
          ? "Flutterwave account is not active yet. Local rails will be available after provider activation."
          : (res.error || "Failed to create collection request")),
      data: { capabilities: caps },
    }, (isIpGuard || isInactive) ? 503 : 502);
  }

  const rData: any = (res.data && typeof res.data === "object" && (res.data as any).data)
    ? (res.data as any).data
    : res.data;
  const providerId = String(rData?.id || rData?.flw_ref || "").trim() || null;
  const providerStatus = String(rData?.status || "").trim();
  const mappedStatus = mapFlutterwaveProviderStatus(providerStatus);

  await supa.from("flutterwave_transfers").upsert({
    user_id: authData.user.id,
    direction: "receive",
    reference,
    provider_transfer_id: providerId,
    source: "flutterwave",
    idempotency_key: reference,
    amount,
    currency,
    destination_country: destinationCountry,
    destination_currency: destinationCurrency,
    channel,
    status: mappedStatus,
    provider_status: providerStatus || null,
    request_payload: { amount, currency, destinationCountry, destinationCurrency, channel, reference },
    provider_response: res.data ?? {},
    provider_request_id: res.requestId || null,
    provider_http_status: Number.isFinite(res.status) ? res.status : null,
    last_error: null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,source,reference" });

  return json({
    success: true,
    data: {
      mode: "collection_create",
      endpoint: "flutterwave-collection-create",
      create_scope: "collection_create",
      write_scope: "money_movement",
      response_contract_version: 1,
      contract_generated_at: new Date().toISOString(),
      provider: "flutterwave",
      direction: "receive",
      source: "flutterwave",
      source_locked_to_flutterwave: true,
      capabilities: caps,
      reference,
      provider_transfer_id: providerId,
      status: mappedStatus,
      collection: res.data,
    },
  });
});
