// bridge-customer — create or fetch a Bridge customer for the signed-in user.
//
// POST body: nothing (uses session). Idempotent on user_profiles.bridge_customer_id.
//
// Response: { success, data: { bridge_customer_id, account_type } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { BridgeProviderError } from "../_shared/providers/bridge-client.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { bridgeOnboardingEnabled, bridgeOnboardingPausedBody, verificationGate, loadVerificationContext } from "../_shared/launch-gates.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function mapBridgeCustomerError(
  error: unknown,
  options?: { accountType?: "individual" | "business" },
): {
  status: number;
  code: string;
  error: string;
  provider_code?: string;
  bridge_request_id?: string;
  expected_verification_status?: "approved";
} {
  const message = String((error as Error)?.message || "").toLowerCase();
  const providerCode = error instanceof BridgeProviderError
    ? String(error.bridge_code || "").toLowerCase()
    : undefined;
  const bridgeRequestId = error instanceof BridgeProviderError ? error.request_id || undefined : undefined;
  const isBusiness = options?.accountType === "business";
  if (providerCode === "has_not_accepted_tos" || message.includes("has_not_accepted_tos")) {
    return {
      status: 409,
      code: "tos_required",
      error: "You must accept terms before continuing verification.",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
    };
  }
  if (providerCode === "requires_active_kyc_status" || message.includes("requires_active_kyc_status")) {
    return {
      status: 409,
      code: "kyc_not_approved",
      error: isBusiness
        ? "Business verification is required before account setup can continue."
        : "Identity verification is required before account setup can continue.",
      expected_verification_status: "approved",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
    };
  }
  if (message.includes("429") || message.includes("rate")) {
    return {
      status: 429,
      code: "rate_limited",
      error: "Too many requests. Please try again shortly.",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
    };
  }
  if (message.includes("timeout") || message.includes("network")) {
    return {
      status: 502,
      code: "provider_unavailable",
      error: "Unable to reach verification services right now. Please retry.",
      ...(providerCode ? { provider_code: providerCode } : {}),
      ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
    };
  }
  return {
    status: 502,
    code: "bridge_customer_failed",
    error: "Unable to initialize account setup right now. Please retry.",
    ...(providerCode ? { provider_code: providerCode } : {}),
    ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({
      success: false,
      code: "missing_bearer_token",
      error: "Authentication required",
    }, 401);
  }

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) {
    return json({
      success: false,
      code: "invalid_auth_token",
      error: "Unauthorized",
    }, 401);
  }

  // Stepped verification gate (#4 + #5): require a PAID plan + admin
  // authorization before any billable Bridge call. The env pause remains the
  // outer guard (checked above), so production stays paused until enabled.
  {
    const __gate = verificationGate(await loadVerificationContext(supa, user.id));
    if (!__gate.allowed) return json(__gate.body, __gate.status);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, full_name, account_type, country, phone, bridge_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    return json({
      success: false,
      code: "profile_not_found",
      error: "User profile was not found",
    }, 404);
  }

  // Country eligibility FIRST — before any idempotent return. Round-10
  // CTO fix: the earlier version checked `bridge_customer_id` first and
  // returned the existing customer payload even for users in newly-
  // prohibited countries (anyone who had managed to get a Bridge customer
  // before the policy tightened would silently bypass the gate). The
  // "no grandfathering" rule (round-9 P0.2) requires the country gate
  // to fire on every call regardless of existing-customer state.
  if (isBridgeBlocked(profile.country)) {
    return json(bridgeCountryBlockResponse(profile.country!), 403);
  }
  logControlledBridgeTraffic("bridge-customer", profile.country, user.id);

  // Idempotent: return existing if any (only reachable for non-blocked
  // countries, per the gate above).
  if (profile.bridge_customer_id) {
    return json({
      success: true,
      code: "bridge_customer_already_exists",
      data: { bridge_customer_id: profile.bridge_customer_id, account_type: profile.account_type, already_exists: true },
    });
  }

  // For business: pull company_name from business_profiles
  let companyName: string | undefined;
  let regNumber:  string | undefined;
  if (profile.account_type === "business") {
    const { data: biz } = await supa
      .from("business_profiles")
      .select("company_name, registration_number")
      .eq("user_id", user.id)
      .maybeSingle();
    companyName = biz?.company_name;
    regNumber   = biz?.registration_number ?? undefined;
  }

  try {
    const result = await bridgeProvider.createCustomer({
      account_type:        profile.account_type as "individual" | "business",
      email:               profile.email,
      full_name:           profile.full_name ?? undefined,
      company_name:        companyName,
      registration_number: regNumber,
      country_code:        (profile.country || "NG").toUpperCase(),
      phone_e164:          profile.phone || undefined,
      borderpay_user_id:   user.id,
    });

    const verificationStatusUpdate =
      profile.account_type === "business"
        ? { bridge_kyb_status: "not_started" as const }
        : { bridge_kyc_status: "not_started" as const };
    const { error: profileUpdateErr } = await supa.from("user_profiles").update({
      bridge_customer_id: result.provider_id,
      ...verificationStatusUpdate,
      updated_at:         new Date().toISOString(),
    }).eq("id", user.id);
    if (profileUpdateErr) {
      return json({
        success: false,
        code: "profile_update_failed",
        error: "Customer initialized but profile sync failed. Please retry.",
      }, 500);
    }

    return json({
      success: true,
      code: "bridge_customer_created",
      data: { bridge_customer_id: result.provider_id, account_type: profile.account_type },
    });
  } catch (e) {
    const mapped = mapBridgeCustomerError(e, {
      accountType: profile.account_type as "individual" | "business",
    });
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      ...(mapped.provider_code ? { provider_code: mapped.provider_code } : {}),
      ...(mapped.bridge_request_id ? { bridge_request_id: mapped.bridge_request_id } : {}),
      ...(mapped.expected_verification_status
        ? { expected_verification_status: mapped.expected_verification_status }
        : {}),
    }, mapped.status);
  }
});
