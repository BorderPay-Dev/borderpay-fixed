// bridge-kyb-link — generate a hosted KYB URL for the signed-in business user.
//
// POST body (optional): { redirect_url?: string, endorsements?: ("base"|"sepa"|"spei"|"crypto")[] }
//
// Response: { success, data: { link_id, link_url, expires_at } | { already_approved: true } }
//
// Side effects:
//   • If business has no bridge_customer_id, creates a Bridge customer
//     (type=business) and stores it on business_profiles.bridge_customer_id
//     (and user_profiles.bridge_customer_id for symmetry).
//   • Stores link_id + link_url + bridge_kyb_status='pending' on
//     business_profiles for replay.
//
// Account-type guard: rejects 403 for non-business users.

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
    .select("id, email, full_name, account_type, country, phone, bridge_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);
  if (profile.account_type !== "business") {
    return json({ success: false, error: "KYB is only for business accounts. Use bridge-kyc-link for individual KYC.", code: "wrong_account_type" }, 403);
  }

  const { data: biz } = await supa
    .from("business_profiles")
    .select("user_id, company_name, registration_number, country, bridge_customer_id, bridge_kyb_link_id, bridge_kyb_link_url, bridge_kyb_status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!biz) return json({ success: false, error: "business_profiles row missing", code: "no_business_profile" }, 404);

  // Bridge prohibits some jurisdictions (e.g. DRC). Block KYB before any
  // Bridge call. Frontend renders a future-state message; no customer is
  // ever created for these users.
  const bizCountry = (biz.country || profile.country || "").toUpperCase();
  if (isBridgeProhibited(bizCountry)) {
    return json(bridgeCountryBlockResponse(bizCountry), 403);
  }

  if (biz.bridge_kyb_status === "approved") {
    return json({ success: true, data: { already_approved: true, bridge_kyb_status: "approved" } });
  }

  if (biz.bridge_kyb_link_url) {
    return json({ success: true, data: { link_url: biz.bridge_kyb_link_url, link_id: biz.bridge_kyb_link_id, reused: true } });
  }

  let bridgeCustomerId = biz.bridge_customer_id || profile.bridge_customer_id;
  if (!bridgeCustomerId) {
    try {
      const result = await bridgeProvider.createCustomer({
        account_type:        "business",
        email:               profile.email,
        full_name:           profile.full_name ?? undefined,
        company_name:        biz.company_name,
        registration_number: biz.registration_number ?? undefined,
        country_code:        (biz.country || profile.country || "NG").toUpperCase(),
        phone_e164:          profile.phone || undefined,
        borderpay_user_id:   user.id,
      });
      bridgeCustomerId = result.provider_id;

      await supa.from("business_profiles").update({
        bridge_customer_id: bridgeCustomerId,
        bridge_kyb_status:  "not_started",
        updated_at:         new Date().toISOString(),
      }).eq("user_id", user.id);
      await supa.from("user_profiles").update({
        bridge_customer_id: bridgeCustomerId,
        updated_at:         new Date().toISOString(),
      }).eq("id", user.id);
    } catch (e) {
      return json({ success: false, error: `Bridge customer create failed: ${(e as Error).message}` }, 502);
    }
  }

  try {
    const result = await bridgeProvider.createKycLink({
      customer_id:  bridgeCustomerId,
      account_type: "business",
      redirect_url: body.redirect_url,
      endorsements: body.endorsements,
    });

    await supa.from("business_profiles").update({
      bridge_kyb_link_id:  result.link_id,
      bridge_kyb_link_url: result.link_url,
      bridge_kyb_status:   "pending",
      updated_at:          new Date().toISOString(),
    }).eq("user_id", user.id);

    return json({ success: true, data: { link_id: result.link_id, link_url: result.link_url, expires_at: result.expires_at } });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
