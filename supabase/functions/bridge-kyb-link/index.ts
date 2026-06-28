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
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
} from "../_shared/providers/bridge-country-policy.ts";
import { bridgeOnboardingEnabled, bridgeOnboardingPausedBody, verificationGate, loadVerificationContext } from "../_shared/launch-gates.ts";

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

async function bridgePost(path: string, body: unknown, idemKey: string, correlationId?: string): Promise<BridgeFetchResult> {
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
      ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
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
    error:      res.ok ? undefined : (parsed?.message || parsed?.error || `HTTP ${res.status}`),
    request_id: res.headers.get("x-request-id") || undefined,
  };
}

function extractLink(parsed: any): { link_url: string | null; link_id: string | null; customer_id?: string; tos_link_url?: string | null } | null {
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
    const tos_link_url: string | null = c?.tos_link?.url || c?.tos_link || c?.data?.tos_link?.url || null;
    if (link_url || tos_link_url) return { link_url, link_id, customer_id, tos_link_url };
  }
  return null;
}

function isVerifiedStatus(value: string | null | undefined): boolean {
  return ["approved", "active", "authorized", "verified", "completed", "complete"].includes(
    String(value || "").toLowerCase(),
  );
}

function mapKybLinkFailure(status: number, parsed: any): { status: number; code: string; error: string; provider_code?: string } {
  const providerCode = String(parsed?.code || parsed?.error_code || "").toLowerCase();
  switch (providerCode) {
    case "has_not_accepted_tos":
      return { status: 409, code: "tos_required", error: "Please accept Terms of Service before starting verification.", provider_code: providerCode };
    case "requires_active_kyc_status":
      return { status: 409, code: "kyb_not_approved", error: "Business verification is not active for this account yet.", provider_code: providerCode };
    case "missing_required_endorsements":
    case "endorsement_requirements_not_met":
      return { status: 403, code: "endorsement_required", error: "Business verification route is not enabled for this account.", provider_code: providerCode };
    case "invalid_parameters":
    case "invalid_json":
    case "bad_request":
      return { status: 400, code: providerCode || "invalid_request", error: "Unable to start business verification. Please review your business profile and try again.", provider_code: providerCode || undefined };
    case "not_allowed":
      return { status: 403, code: "route_not_enabled", error: "Business verification is not enabled for this account.", provider_code: providerCode };
    default:
      break;
  }
  if (status === 429) {
    return { status: 429, code: "rate_limited", error: "Too many verification attempts. Please wait and try again." };
  }
  if (status >= 500 || status === 424 || status === 503) {
    return { status: 502, code: "provider_unavailable", error: "Business verification service is temporarily unavailable. Please try again shortly." };
  }
  if (status >= 400 && status < 500) {
    return { status: 400, code: "verification_rejected", error: "Unable to start business verification right now. Please try again." };
  }
  return { status: 502, code: "provider_error", error: "Unable to start business verification right now. Please try again." };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);
  const correlationId = crypto.randomUUID();

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  // Stepped verification gate (#4 + #5): require a PAID plan + admin
  // authorization before any billable Bridge call. The env pause remains the
  // outer guard (checked above), so production stays paused until enabled.
  {
    const __gate = verificationGate(await loadVerificationContext(supa, user.id));
    if (!__gate.allowed) return json(__gate.body, __gate.status);
  }

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
  if (biz.bridge_customer_id) reqBody.customer_id = biz.bridge_customer_id;

  const idemSource = biz.bridge_customer_id || user.id;
  let r = await bridgePost(
    "/v0/kyc_links",
    reqBody,
    `borderpay:kyb:business:${idemSource}`,
    correlationId,
  );

  let link = extractLink(r.data);

  // Legacy safety: stale/invalid stored bridge_customer_id can block KYB.
  // Retry once without customer_id so Bridge hosted flow can create/recover.
  if (!r.ok && !link && biz.bridge_customer_id) {
    const fallbackBody = { ...reqBody };
    delete fallbackBody.customer_id;
    r = await bridgePost(
      "/v0/kyc_links",
      fallbackBody,
      `borderpay:kyb:business:fallback:${user.id}`,
      correlationId,
    );
    link = extractLink(r.data);
  }

  if (!r.ok && !link) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(`bridge-kyb-link: Bridge rejected rid=${r.request_id || ""} status=${r.status} body=${detail}`);
    const mapped = mapKybLinkFailure(r.status, r.data);
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      provider_code: mapped.provider_code,
      bridge_request_id: r.request_id,
      bridge_status:     r.status,
      correlation_id:    correlationId,
    }, mapped.status);
  }

  if (!link || (!link.link_url && !link.tos_link_url)) {
    console.error(`bridge-kyb-link: missing link/url body=${(r.raw_text || "").slice(0, 800)}`);
    return json({
      success: false,
      error:   `Business verification link response missing link URL`,
      bridge_request_id: r.request_id,
      correlation_id: correlationId,
    }, 502);
  }

  const { error: updateErr } = await supa.from("business_profiles").update({
    bridge_kyb_link_id:  link.link_id,
    bridge_kyb_link_url: link.link_url,
    ...(link.customer_id ? { bridge_customer_id: link.customer_id } : {}),
    updated_at:          new Date().toISOString(),
  }).eq("user_id", user.id);
  if (updateErr) {
    console.error(`bridge-kyb-link: business_profiles update failed for user=${user.id}: ${updateErr.message}`);
    return json({
      success: false,
      error:   `business_profiles update failed: ${updateErr.message}`,
      bridge_request_id: r.request_id,
      correlation_id: correlationId,
    }, 500);
  }

  const expires_at = r.data?.data?.expires_at || r.data?.expires_at || r.data?.existing_kyc_link?.expires_at;
  const tos_status_raw =
    r.data?.data?.tos_status ||
    r.data?.tos_status ||
    r.data?.existing_kyc_link?.tos_status ||
    null;
  const tos_required = Boolean(
    link.tos_link_url &&
    String(tos_status_raw || "").toLowerCase() !== "accepted",
  );
  return json({
    success: true,
    data: {
      link_id: link.link_id,
      link_url: link.link_url,
      tos_link_url: link.tos_link_url ?? null,
      tos_status: tos_status_raw,
      tos_required,
      expires_at,
      correlation_id: correlationId,
      reused: !r.ok ? true : undefined,
    },
  });
});
