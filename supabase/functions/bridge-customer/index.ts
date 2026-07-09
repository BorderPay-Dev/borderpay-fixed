// bridge-customer — create or fetch a Bridge customer for the signed-in user.
//
// POST body: nothing (uses session). Idempotent on user_profiles.bridge_customer_id.
//
// Response: { success, data: { bridge_customer_id, account_type } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  // Stepped verification gate: ToS must be durably accepted before any
  // provider customer/KYC/KYB call.
  {
    const __gate = verificationGate(await loadVerificationContext(supa, user.id));
    if (!__gate.allowed) return json(__gate.body, __gate.status);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, full_name, account_type, country, phone, bridge_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);

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
    return json({ success: true, data: { bridge_customer_id: profile.bridge_customer_id, account_type: profile.account_type, already_exists: true } });
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

    await supa.from("user_profiles").update({
      bridge_customer_id: result.provider_id,
      bridge_kyc_status:  "not_started",
      updated_at:         new Date().toISOString(),
    }).eq("id", user.id);

    return json({ success: true, data: { bridge_customer_id: result.provider_id, account_type: profile.account_type } });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
