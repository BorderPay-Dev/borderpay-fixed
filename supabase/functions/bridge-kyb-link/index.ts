// bridge-kyb-link v6 — embedded /v0/kyc_links flow for business accounts.
//
// Mirrors bridge-kyc-link v6: always send email + business_legal_name;
// attach customer_id when present; handle Bridge's 400 existing_kyc_link
// as success. KYB-specific differences:
//   • type = "business"
//   • business_legal_name (instead of full_name)
//   • reads business_profiles for company_name + bridge_kyb_status
//   • writes bridge_kyb_status (not bridge_kyc_status)
//   • returns Bridge tos_link_url before the hosted KYB link, matching the
//     working Individual KYC response contract used by the shared webview.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
} from "../_shared/providers/bridge-country-policy.ts";
import { bridgeOnboardingEnabled, bridgeOnboardingPausedBody } from "../_shared/launch-gates.ts";

const BRIDGE_BASE_URL = (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz").replace(/\/+$/, "");
const BRIDGE_API_KEY  = Deno.env.get("BRIDGE_API_KEY") ?? "";
const APP_URL         = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface BridgeFetchResult {
  ok:         boolean;
  status:     number;
  data:       any;
  raw_text:   string;
  error?:     string;
  request_id?: string;
}

interface ExtractedLinks {
  kyc_link_url: string | null;
  kyc_link_id: string | null;
  customer_id?: string;
  tos_link_url: string | null;
}

async function bridgePost(path: string, body: unknown, idemKey: string): Promise<BridgeFetchResult> {
  if (!BRIDGE_API_KEY) {
    return { ok: false, status: 0, data: null, raw_text: "BRIDGE_API_KEY missing", error: "BRIDGE_API_KEY missing" };
  }
  const res = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Api-Key":         BRIDGE_API_KEY,
      "Accept":          "application/json",
      "Content-Type":    "application/json",
      "Idempotency-Key": idemKey,
      "User-Agent":      "borderpay-edge/1.0",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  if (text) { try { parsed = JSON.parse(text); } catch { /* keep null */ } }
  return {
    ok:         res.ok,
    status:     res.status,
    data:       parsed,
    raw_text:   text,
    error:      res.ok ? undefined : (parsed?.message || `HTTP ${res.status}`),
    request_id: res.headers.get("x-request-id") || undefined,
  };
}

function extractLinks(parsed: any): ExtractedLinks | null {
  if (!parsed) return null;
  const candidates = [parsed?.data, parsed, parsed?.existing_kyc_link].filter(Boolean);
  for (const c of candidates) {
    const kycLinkUrl: string | null =
      c?.kyc_link?.url ||
      (typeof c?.kyc_link === "string" ? c.kyc_link : null) ||
      c?.url ||
      c?.link;
    const linkId: string | null = c?.kyc_link?.id || c?.id;
    const customer_id: string | undefined = c?.customer_id || c?.kyc_link?.customer_id;
    const tosLinkUrl: string | null = c?.tos_link?.url || c?.tos_link || c?.data?.tos_link?.url || null;
    if (kycLinkUrl || tosLinkUrl) {
      return {
        kyc_link_url: kycLinkUrl || null,
        kyc_link_id: linkId || null,
        customer_id,
        tos_link_url: tosLinkUrl || null,
      };
    }
  }
  return null;
}

function isVerifiedStatus(value: string | null | undefined): boolean {
  return ["approved", "active", "authorized", "verified", "completed", "complete"].includes(
    String(value || "").toLowerCase(),
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  if (!user.email_confirmed_at) {
    return json({
      success: false,
      code: "email_verification_required",
      error: "Verify your email first, then retry verification.",
      summary: {
        code: "email_verification_required",
      },
    }, 409);
  }

  let body: { redirect_url?: string; endorsements?: string[] } = {};
  try { body = await req.json(); } catch { /* tolerant */ }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, account_type, country, bridge_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);
  if (profile.account_type !== "business") {
    return json({ success: false, error: "KYB is only for business accounts. Use bridge-kyc-link.", code: "wrong_account_type" }, 403);
  }
  if (isBridgeBlocked(profile.country)) {
    return json(bridgeCountryBlockResponse(profile.country!), 403);
  }
  logControlledBridgeTraffic("bridge-kyb-link", profile.country, user.id);
  if (!profile.email) {
    return json({ success: false, error: "Profile missing email — cannot start verification" }, 400);
  }

  // business_profiles uses bridge_kyb_link_* (KYB-prefixed) columns;
  // the bridge_kyc_link_* columns live on user_profiles for the
  // individual KYC flow and do not exist on this table.
  // Round-7 fix: previous version read/wrote bridge_kyc_link_* against
  // business_profiles, which 400s on PostgREST and never persisted the
  // link.
  const { data: biz } = await supa
    .from("business_profiles")
    .select("company_name, registration_number, bridge_customer_id, bridge_kyb_status, bridge_kyb_link_id, bridge_kyb_link_url")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!biz?.company_name) return json({ success: false, error: "business_profiles missing company_name" }, 404);

  if (isVerifiedStatus(biz.bridge_kyb_status)) {
    return json({ success: true, data: { already_approved: true, bridge_kyb_status: "approved" } });
  }
  // Do not short-circuit to cached link_url: old links can expire and trap users
  // in repeated verification errors. Always ask Bridge for the current link state.

  const reqBody: Record<string, unknown> = {
    type:                 "business",
    email:                profile.email,
    business_legal_name:  biz.company_name,
    endorsements:         body.endorsements ?? ["base"],
    redirect_uri:         body.redirect_url || `${APP_URL}/onboarding/kyc-complete`,
  };
  const existingCustomerId = biz.bridge_customer_id || profile.bridge_customer_id;
  if (existingCustomerId) reqBody.customer_id = existingCustomerId;

  const idemSource = existingCustomerId || user.id;
  let r = await bridgePost(
    "/v0/kyc_links",
    reqBody,
    `borderpay:kyb:business:${idemSource}`,
  );

  let links = extractLinks(r.data);

  // Legacy safety: stale/invalid stored bridge_customer_id can block KYB.
  // Retry once without customer_id so Bridge hosted flow can create/recover.
  if (!r.ok && !links && existingCustomerId) {
    const fallbackBody = { ...reqBody };
    delete fallbackBody.customer_id;
    r = await bridgePost(
      "/v0/kyc_links",
      fallbackBody,
      `borderpay:kyb:business:fallback:${user.id}`,
    );
    links = extractLinks(r.data);
  }

  if (!r.ok && !links) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(`bridge-kyb-link: Bridge rejected rid=${r.request_id || ""} status=${r.status} body=${detail}`);
    return json({
      success: false,
      error:   `Business verification link request failed [${r.status}]: ${r.error || "unknown"}`,
      bridge_request_id: r.request_id,
      bridge_status:     r.status,
    }, 502);
  }

  if (!links) {
    console.error(`bridge-kyb-link: missing link/url body=${(r.raw_text || "").slice(0, 800)}`);
    return json({
      success: false,
      error:   `Business verification link response missing link URL`,
      bridge_request_id: r.request_id,
    }, 502);
  }

  const customerId = links.customer_id || existingCustomerId || null;
  // A ToS-only response intentionally has no KYB link yet. Do not overwrite
  // persisted hosted-link columns with null while the customer accepts ToS.
  if (links.kyc_link_url && links.kyc_link_id) {
    const { error: updateErr } = await supa.from("business_profiles").update({
      bridge_kyb_link_id:  links.kyc_link_id,
      bridge_kyb_link_url: links.kyc_link_url,
      ...(customerId ? { bridge_customer_id: customerId } : {}),
      updated_at:          new Date().toISOString(),
    }).eq("user_id", user.id);
    if (updateErr) {
      console.error(`bridge-kyb-link: business_profiles update failed for user=${user.id}: ${updateErr.message}`);
      return json({
        success: false,
        error:   `business_profiles update failed: ${updateErr.message}`,
        bridge_request_id: r.request_id,
      }, 500);
    }
  }

  if (customerId) {
    const { error: profileUpdateErr } = await supa.from("user_profiles").update({
      bridge_customer_id: customerId,
      updated_at:         new Date().toISOString(),
    }).eq("id", user.id);
    if (profileUpdateErr) {
      console.error(`bridge-kyb-link: user_profiles customer mirror failed for user=${user.id}: ${profileUpdateErr.message}`);
      return json({
        success: false,
        error:   `user_profiles update failed: ${profileUpdateErr.message}`,
        bridge_request_id: r.request_id,
      }, 500);
    }
  }

  const expires_at = r.data?.data?.expires_at || r.data?.expires_at || r.data?.existing_kyc_link?.expires_at;
  return json({
    success: true,
    data: {
      link_id: links.kyc_link_id,
      link_url: links.kyc_link_url,
      tos_link_url: links.tos_link_url,
      expires_at,
      reused: !r.ok ? true : undefined,
    },
  });
});
