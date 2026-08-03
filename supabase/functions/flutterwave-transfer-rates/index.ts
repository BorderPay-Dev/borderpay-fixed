import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFlutterwaveCapabilities, flutterwaveGetTransferRates } from "../_shared/providers/flutterwave.ts";
import {
  evaluateProviderCorridorPolicy,
  isBridgeProfileVerified,
} from "../_shared/providers/provider-corridor-policy.ts";
import { authenticateAfricanRailsTester } from "../_shared/african-rails-access.ts";

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

  const access = await authenticateAfricanRailsTester(supa, req);
  if (!access.allowed) {
    return json({ success: false, code: access.code, error: access.message }, access.status);
  }
  const authData = { user: access.user };

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !(caps.receive_enabled || caps.payout_enabled)) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "This payout quote is temporarily unavailable.",
      data: { capabilities: caps, source_filter: "flutterwave" },
    }, 503);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const source = String(body?.source_currency || "").trim().toUpperCase();
  const destination = String(body?.destination_currency || "").trim().toUpperCase();
  const destinationCountry = String(body?.destination_country || "").trim().toUpperCase();
  const channel = String(body?.channel || "bank").trim().toLowerCase();
  const destinationAmount = Number(body?.destination_amount);

  if (!source || !destination) {
    return json({ success: false, error: "source_currency and destination_currency are required" }, 400);
  }
  if (!destinationCountry) {
    return json({ success: false, error: "destination_country is required" }, 400);
  }
  if (!["bank", "mobile_money"].includes(channel)) {
    return json({ success: false, error: "channel must be bank or mobile_money" }, 400);
  }
  if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) {
    return json({
      success: false,
      code: "destination_amount_required",
      error: "destination_amount must be greater than 0. This quote requires the requested recipient amount; a source amount is not accepted here.",
    }, 400);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, account_type, country, bridge_kyc_status, bridge_kyb_status, bridge_account_status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (!profile) {
    return json({ success: false, code: "profile_missing", error: "User profile is missing." }, 404);
  }

  const corridorDecision = await evaluateProviderCorridorPolicy(supa, {
    provider: "flutterwave",
    direction: "payout",
    userCountry: profile.country,
    destinationCountry,
    destinationCurrency: destination,
    channel: channel as "bank" | "mobile_money",
    bridgeVerified: isBridgeProfileVerified(profile),
  });
  if (!corridorDecision.allowed) {
    return json(
      { success: false, code: corridorDecision.code, error: corridorDecision.message },
      corridorDecision.code === "policy_lookup_failed" ? 503 : 403,
    );
  }

  const res = await flutterwaveGetTransferRates({
    source_currency: source,
    destination_currency: destination,
    destination_amount: destinationAmount,
    reference: `quote:${authData.user.id}:${source}:${destination}:${destinationAmount}`,
  });
  if (!res.ok) {
    const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
    const isInactive = res.error === "flutterwave_account_inactive" || res.error === "flutterwave_auth_error";
    return json({
      success: false,
      code: isIpGuard
        ? "static_ip_not_ready"
        : (isInactive ? "provider_inactive" : "upstream_error"),
      error: isIpGuard
        ? "This payout quote is temporarily unavailable while connectivity is being verified."
        : (isInactive
          ? "This payout quote is temporarily unavailable."
          : "We could not quote this payout right now."),
      data: {
        capabilities: caps,
        source_filter: "flutterwave",
        source_currency: source,
        destination_currency: destination,
        destination_country: destinationCountry,
        channel,
      },
    }, (isIpGuard || isInactive) ? 503 : 502);
  }

  return json({
    success: true,
    data: {
      endpoint: "flutterwave-transfer-rates",
      read_scope: "quote",
      source_scope: "flutterwave_only",
      response_contract_version: 1,
      contract_generated_at: new Date().toISOString(),
      provider: "flutterwave",
      source_filter: "flutterwave",
      capabilities: caps,
      source_currency: source,
      destination_currency: destination,
      destination_country: destinationCountry,
      channel,
      destination_amount: destinationAmount,
      quote_semantics: "destination_amount",
      rates: res.data,
    },
  });
});
