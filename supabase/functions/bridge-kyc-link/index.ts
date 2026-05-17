// bridge-kyc-link — generate a hosted KYC URL for the signed-in INDIVIDUAL user.
//
// POST body (optional): { redirect_url?: string, endorsements?: ("base"|"sepa"|"spei"|"crypto")[] }
//
// Response: { success, data: { link_id, link_url, expires_at } | { already_approved: true } }
//
// Side effects:
//   • If user_profiles.bridge_customer_id is missing, lazy-creates a Bridge
//     customer with account_type='individual' and stores the ID on
//     user_profiles. Bridge customer creation is therefore deferred to the
//     explicit Start KYC click — never at signup.
//   • Stores link_id + link_url + bridge_kyc_status='pending' on
//     user_profiles for replay.
//
// Account-type guard: rejects 403 wrong_account_type for business users
// (they must use bridge-kyb-link instead). Mirrors the symmetric guard in
// bridge-kyb-link.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { isBridgeProhibited, bridgeCountryBlockResponse } from "../_shared/providers/bridge-country-policy.ts";

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

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { redirect_url?: string; endorsements?: ("base"|"sepa"|"spei"|"crypto")[] };
  try { body = await req.json(); } catch { body = {}; }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, full_name, account_type, country, phone, bridge_customer_id, bridge_kyc_link_id, bridge_kyc_link_url, bridge_kyc_status")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);
  if (profile.account_type === "business") {
    return json({ success: false, error: "KYC is only for individual accounts. Use bridge-kyb-link for business KYB.", code: "wrong_account_type" }, 403);
  }
  if (isBridgeProhibited(profile.country)) {
    return json(bridgeCountryBlockResponse(profile.country!), 403);
  }

  if (profile.bridge_kyc_status === "approved") {
    return json({ success: true, data: { already_approved: true, bridge_kyc_status: "approved" } });
  }

  if (profile.bridge_kyc_link_url) {
    return json({ success: true, data: { link_id: profile.bridge_kyc_link_id, link_url: profile.bridge_kyc_link_url, reused: true } });
  }

  let bridgeCustomerId = profile.bridge_customer_id;
  if (!bridgeCustomerId) {
    try {
      const result = await bridgeProvider.createCustomer({
        account_type:      "individual",
        email:             profile.email,
        full_name:         profile.full_name ?? undefined,
        country_code:      (profile.country || "NG").toUpperCase(),
        phone_e164:        profile.phone || undefined,
        borderpay_user_id: user.id,
      });
      bridgeCustomerId = result.provider_id;

      await supa.from("user_profiles").update({
        bridge_customer_id: bridgeCustomerId,
        bridge_kyc_status:  "not_started",
        updated_at:         new Date().toISOString(),
      }).eq("id", user.id);
    } catch (e) {
      return json({ success: false, error: `Bridge customer create failed: ${(e as Error).message}` }, 502);
    }
  }

  try {
    const result = await bridgeProvider.createKycLink({
      customer_id:  bridgeCustomerId,
      account_type: "individual",
      redirect_url: body.redirect_url,
      endorsements: body.endorsements,
    });

    await supa.from("user_profiles").update({
      bridge_kyc_link_id:  result.link_id,
      bridge_kyc_link_url: result.link_url,
      bridge_kyc_status:   "pending",
      updated_at:          new Date().toISOString(),
    }).eq("id", user.id);

    return json({ success: true, data: { link_id: result.link_id, link_url: result.link_url, expires_at: result.expires_at } });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
