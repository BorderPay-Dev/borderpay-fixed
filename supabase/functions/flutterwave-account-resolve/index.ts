import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFlutterwaveCapabilities, flutterwaveResolveBankAccount } from "../_shared/providers/flutterwave.ts";
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
  if (!caps.configured || !caps.payout_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "This payout route is temporarily unavailable.",
      data: { capabilities: caps, source_filter: "flutterwave" },
    }, 503);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const accountNumber = String(body?.account_number || "").trim();
  const bankCode = String(body?.bank_code || "").trim();
  const destinationCountry = String(body?.destination_country || "").trim().toUpperCase();
  const destinationCurrency = String(body?.destination_currency || "").trim().toUpperCase();
  if (!accountNumber || !bankCode || !destinationCountry) {
    return json({ success: false, error: "account_number, bank_code and destination_country are required" }, 400);
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
    destinationCurrency: destinationCurrency || undefined,
    channel: "bank",
    bridgeVerified: isBridgeProfileVerified(profile),
  });
  if (!corridorDecision.allowed) {
    return json(
      { success: false, code: corridorDecision.code, error: corridorDecision.message },
      corridorDecision.code === "policy_lookup_failed" ? 503 : 403,
    );
  }

  const res = await flutterwaveResolveBankAccount({
    account_number: accountNumber,
    bank_code: bankCode,
  });
  if (!res.ok) {
    if (res.error === "flutterwave_v4_kes_account_lookup_not_supported") {
      return json({
        success: false,
        code: "account_lookup_not_available",
        error: "Account name lookup is not available for this Kenya route. Recipient details will be validated before payout submission.",
      }, 422);
    }
    const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
    const isInactive = res.error === "flutterwave_account_inactive" || res.error === "flutterwave_auth_error";
    return json({
      success: false,
      code: isIpGuard
        ? "static_ip_not_ready"
        : (isInactive ? "provider_inactive" : "upstream_error"),
      error: isIpGuard
        ? "Account validation is temporarily unavailable while connectivity is being verified."
        : (isInactive
          ? "Account validation is temporarily unavailable."
          : "We could not validate this account right now."),
      data: {
        capabilities: caps,
        source_filter: "flutterwave",
        destination_country: destinationCountry,
        destination_currency: destinationCurrency || null,
      },
    }, (isIpGuard || isInactive) ? 503 : 502);
  }

  return json({
    success: true,
    data: {
      endpoint: "flutterwave-account-resolve",
      read_scope: "account_resolve",
      source_scope: "flutterwave_only",
      response_contract_version: 1,
      contract_generated_at: new Date().toISOString(),
      provider: "flutterwave",
      source_filter: "flutterwave",
      capabilities: caps,
      destination_country: destinationCountry,
      destination_currency: destinationCurrency || null,
      resolution: res.data,
    },
  });
});
