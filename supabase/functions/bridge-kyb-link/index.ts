// bridge-kyb-link v5 — embedded /v0/kyc_links flow for business accounts.
//
// Mirrors bridge-kyc-link v6: always send email + business_legal_name;
// attach customer_id when present; handle Bridge's 400 existing_kyc_link
// as success. KYB-specific differences:
//   • type = "business"
//   • business_legal_name (instead of full_name)
//   • reads business_profiles for company_name + bridge_kyb_status
//   • writes bridge_kyb_status (not bridge_kyc_status)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BRIDGE_BASE_URL = (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz").replace(/\/+$/, "");
const BRIDGE_API_KEY  = Deno.env.get("BRIDGE_API_KEY") ?? "";
const APP_URL         = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";
const BRIDGE_PROHIBITED = new Set(["CD"]);

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

function extractLink(parsed: any): { link_url: string; link_id: string; customer_id?: string } | null {
  if (!parsed) return null;
  const candidates = [parsed?.data, parsed, parsed?.existing_kyc_link].filter(Boolean);
  for (const c of candidates) {
    const link_url: string | null =
      c?.kyc_link?.url ||
      (typeof c?.kyc_link === "string" ? c.kyc_link : null) ||
      c?.url ||
      c?.link;
    const link_id: string | null  = c?.kyc_link?.id || c?.id;
    const customer_id: string | undefined = c?.customer_id || c?.kyc_link?.customer_id;
    if (link_url && link_id) return { link_url, link_id, customer_id };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { redirect_url?: string; endorsements?: string[] } = {};
  try { body = await req.json(); } catch { /* tolerant */ }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, account_type, country")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);
  if (profile.account_type !== "business") {
    return json({ success: false, error: "KYB is only for business accounts. Use bridge-kyc-link.", code: "wrong_account_type" }, 403);
  }
  if (profile.country && BRIDGE_PROHIBITED.has(profile.country.toUpperCase())) {
    const human = profile.country.toUpperCase() === "CD" ? "DRC" : profile.country.toUpperCase();
    return json({
      success: false,
      code:    "country_not_supported",
      error:   `${human} support is coming through our African local rails partner.`,
      country: profile.country.toUpperCase(),
    }, 403);
  }
  if (!profile.email) {
    return json({ success: false, error: "Profile missing email — cannot start verification" }, 400);
  }

  const { data: biz } = await supa
    .from("business_profiles")
    .select("company_name, registration_number, bridge_customer_id, bridge_kyb_status, bridge_kyc_link_id, bridge_kyc_link_url")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!biz?.company_name) return json({ success: false, error: "business_profiles missing company_name" }, 404);

  if ((biz.bridge_kyb_status || "").toLowerCase() === "approved") {
    return json({ success: true, data: { already_approved: true, bridge_kyb_status: "approved" } });
  }
  if (biz.bridge_kyc_link_url) {
    return json({
      success: true,
      data: { link_id: biz.bridge_kyc_link_id, link_url: biz.bridge_kyc_link_url, reused: true },
    });
  }

  const reqBody: Record<string, unknown> = {
    type:                 "business",
    email:                profile.email,
    business_legal_name:  biz.company_name,
    endorsements:         body.endorsements ?? ["base"],
    redirect_uri:         body.redirect_url || `${APP_URL}/onboarding/kyc-complete`,
  };
  if (biz.bridge_customer_id) reqBody.customer_id = biz.bridge_customer_id;

  const idemSource = biz.bridge_customer_id || user.id;
  const r = await bridgePost(
    "/v0/kyc_links",
    reqBody,
    `borderpay:kyb:business:${idemSource}`,
  );

  const link = extractLink(r.data);

  if (!r.ok && !link) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(`bridge-kyb-link: Bridge rejected rid=${r.request_id || ""} status=${r.status} body=${detail}`);
    return json({
      success: false,
      error:   `Bridge createKybLink failed [${r.status}]: ${r.error || detail || "unknown"}`,
      bridge_request_id: r.request_id,
      bridge_status:     r.status,
      bridge_body:       detail,
    }, 502);
  }

  if (!link) {
    console.error(`bridge-kyb-link: missing link/url body=${(r.raw_text || "").slice(0, 800)}`);
    return json({
      success: false,
      error:   `Bridge createKybLink: missing link/url in response`,
      bridge_request_id: r.request_id,
    }, 502);
  }

  await supa.from("business_profiles").update({
    bridge_kyc_link_id:  link.link_id,
    bridge_kyc_link_url: link.link_url,
    bridge_kyb_status:   "pending",
    ...(link.customer_id ? { bridge_customer_id: link.customer_id } : {}),
    updated_at:          new Date().toISOString(),
  }).eq("user_id", user.id);

  const expires_at = r.data?.data?.expires_at || r.data?.expires_at || r.data?.existing_kyc_link?.expires_at;
  return json({
    success: true,
    data: { link_id: link.link_id, link_url: link.link_url, expires_at, reused: !r.ok ? true : undefined },
  });
});
