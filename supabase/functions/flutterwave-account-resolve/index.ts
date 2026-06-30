import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getFlutterwaveCapabilities, flutterwaveResolveBankAccount } from "../_shared/providers/flutterwave.ts";
import { evaluateProviderCorridorPolicy } from "../_shared/providers/provider-corridor-policy.ts";

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

function isBridgeVerified(profile: any): boolean {
  const accountStatus = String(profile?.bridge_account_status || "").toLowerCase();
  if (["active", "approved", "authorized"].includes(accountStatus)) return true;
  const accountType = String(profile?.account_type || "individual").toLowerCase();
  const status = String(accountType === "business" ? profile?.bridge_kyb_status : profile?.bridge_kyc_status || "").toLowerCase();
  return ["approved", "active", "authorized", "verified", "completed", "complete"].includes(status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.payout_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave payout rails are not enabled in this environment.",
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
    bridgeVerified: isBridgeVerified(profile),
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
    return json({
      success: false,
      code: "upstream_error",
      error: res.error || "Failed to resolve account",
      data: {
        capabilities: caps,
        destination_country: destinationCountry,
        destination_currency: destinationCurrency || null,
      },
    }, 502);
  }

  return json({
    success: true,
    data: {
      capabilities: caps,
      destination_country: destinationCountry,
      destination_currency: destinationCurrency || null,
      resolution: res.data,
    },
  });
});
