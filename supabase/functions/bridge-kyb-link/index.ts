import { kybPortalHandoff } from "../_shared/kyb-portal-handoff.ts";
import { customerAppOrigin } from "../_shared/white-label-config.ts";
// bridge-kyb-link v5 — embedded /v0/kyc_links flow for business accounts.
//
// Mirrors bridge-kyc-link v6: always send email + full_name;
// attach customer_id when present; handle Bridge's 400 existing_kyc_link
// as success. KYB-specific differences:
//   • type = "business"
//   • full_name contains the business entity's legal name
//   • reads business_profiles for company_name + bridge_kyb_status
//   • writes bridge_kyb_status (not bridge_kyc_status)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bridgeCountryBlockResponse,
  isBridgeBlocked,
  logControlledBridgeTraffic,
} from "../_shared/providers/bridge-country-policy.ts";
import {
  bridgeOnboardingEnabled,
  bridgeOnboardingPausedBody,
} from "../_shared/launch-gates.ts";
import {
  verificationRedirectUrl,
  verifiedHostedLink,
} from "../_shared/bridge-verification-url.ts";

const BRIDGE_BASE_URL =
  (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz").replace(
    /\/+$/,
    "",
  );
const BRIDGE_API_KEY = Deno.env.get("BRIDGE_API_KEY") ?? "";
const APP_URL = Deno.env.get("BORDERPAY_APP_URL") ??
  "https://app.borderpayafrica.com";
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const KYB_LINK_CONTRACT_VERSION = "full-name-v2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface BridgeFetchResult {
  ok: boolean;
  status: number;
  data: any;
  raw_text: string;
  error?: string;
  request_id?: string;
}

async function bridgePost(
  path: string,
  body: unknown,
  idemKey: string,
): Promise<BridgeFetchResult> {
  if (!BRIDGE_API_KEY) {
    return {
      ok: false,
      status: 0,
      data: null,
      raw_text: "BRIDGE_API_KEY missing",
      error: "BRIDGE_API_KEY missing",
    };
  }
  const res = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Api-Key": BRIDGE_API_KEY,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey,
      "User-Agent": "borderpay-edge/1.0",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch { /* keep null */ }
  }
  return {
    ok: res.ok,
    status: res.status,
    data: parsed,
    raw_text: text,
    error: res.ok ? undefined : (parsed?.message || `HTTP ${res.status}`),
    request_id: res.headers.get("x-request-id") || undefined,
  };
}

async function bridgeGet(path: string): Promise<BridgeFetchResult> {
  if (!BRIDGE_API_KEY) {
    return {
      ok: false,
      status: 0,
      data: null,
      raw_text: "BRIDGE_API_KEY missing",
      error: "BRIDGE_API_KEY missing",
    };
  }
  const res = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "Api-Key": BRIDGE_API_KEY,
      "Accept": "application/json",
      "User-Agent": "borderpay-edge/1.0",
    },
  });
  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch { /* keep null */ }
  }
  return {
    ok: res.ok,
    status: res.status,
    data: parsed,
    raw_text: text,
    error: res.ok ? undefined : (parsed?.message || `HTTP ${res.status}`),
    request_id: res.headers.get("x-request-id") || undefined,
  };
}

function extractLink(parsed: any): {
  link_url: string | null;
  link_id: string | null;
  customer_id?: string;
  tos_link_url: string | null;
} | null {
  if (!parsed) return null;
  const candidates = [parsed?.data, parsed, parsed?.existing_kyc_link].filter(
    Boolean,
  );
  let link_url: string | null = null;
  let link_id: string | null = null;
  let customer_id: string | undefined;
  let tos_link_url: string | null = null;
  for (const c of candidates) {
    link_url ||= c?.kyc_link?.url ||
      (typeof c?.kyc_link === "string" ? c.kyc_link : null) ||
      c?.url ||
      c?.link || null;
    link_id ||= c?.kyc_link?.id || c?.id || null;
    customer_id ||= c?.customer_id || c?.kyc_link?.customer_id;
    tos_link_url ||= c?.tos_link?.url ||
      (typeof c?.tos_link === "string" ? c.tos_link : null) ||
      c?.tos_acceptance_link?.url ||
      (typeof c?.tos_acceptance_link === "string"
        ? c.tos_acceptance_link
        : null) ||
      null;
  }
  return link_url || tos_link_url
    ? { link_url, link_id, customer_id, tos_link_url }
    : null;
}

function isVerifiedStatus(value: string | null | undefined): boolean {
  return [
    "approved",
    "active",
    "authorized",
    "verified",
    "completed",
    "complete",
  ].includes(
    String(value || "").toLowerCase(),
  );
}

const BRIDGE_KYB_STATUSES = new Set([
  "not_started",
  "incomplete",
  "awaiting_rfi",
  "needs_edd",
  "needs_ubos",
  "under_review",
  "pending",
  "approved",
  "rejected",
  "paused",
  "offboarded",
]);

function extractKybStatus(parsed: any): string | null {
  const candidates = [parsed?.data, parsed, parsed?.existing_kyc_link].filter(
    Boolean,
  );
  for (const candidate of candidates) {
    let raw = String(candidate?.kyc_status ?? candidate?.status ?? "").trim()
      .toLowerCase();
    if (raw === "awaiting_ubo") raw = "needs_ubos";
    if (raw === "awaiting_questionnaire") raw = "awaiting_rfi";
    if (raw === "deposits_restricted") raw = "needs_edd";
    if (BRIDGE_KYB_STATUSES.has(raw)) return raw;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ success: false, error: "POST only" }, 405);
  }

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ success: false, error: "Authorization required" }, 401);
  }
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }
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

  const portal = await kybPortalHandoff(user, token);
  if (portal) return json(portal, portal.success ? 200 : 503);

  if (!bridgeOnboardingEnabled()) {
    return json(bridgeOnboardingPausedBody(), 503);
  }

  let body: { redirect_url?: string; endorsements?: string[]; phase?: "terms" | "kyb" } = {};
  try {
    body = await req.json();
  } catch { /* tolerant */ }
  let customerOrigin: string;
  try { customerOrigin = await customerAppOrigin(supa, user.id, APP_URL); }
  catch { return json({success:false,code:"customer_app_unavailable",error:"Verification is temporarily unavailable. Please try again."},503); }
  const redirectUrl = verificationRedirectUrl(customerOrigin, body.redirect_url);
  const phase = body.phase === "terms" || body.phase === "kyb" ? body.phase : null;

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, account_type, country, bridge_customer_id, bridge_account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    return json({ success: false, error: "user_profiles row missing" }, 404);
  }
  if (profile.account_type !== "business") {
    return json({
      success: false,
      error: "KYB is only for business accounts. Use bridge-kyc-link.",
      code: "wrong_account_type",
    }, 403);
  }
  if (isBridgeBlocked(profile.country)) {
    return json(bridgeCountryBlockResponse(profile.country!), 403);
  }
  logControlledBridgeTraffic("bridge-kyb-link", profile.country, user.id);
  if (!profile.email) {
    return json({
      success: false,
      error: "Profile missing email — cannot start verification",
    }, 400);
  }

  // business_profiles uses bridge_kyb_link_* (KYB-prefixed) columns;
  // the bridge_kyc_link_* columns live on user_profiles for the
  // individual KYC flow and do not exist on this table.
  // Round-7 fix: previous version read/wrote bridge_kyc_link_* against
  // business_profiles, which 400s on PostgREST and never persisted the
  // link.
  const { data: biz } = await supa
    .from("business_profiles")
    .select(
      "company_name, registration_number, bridge_customer_id, bridge_kyb_status, bridge_kyb_link_id, bridge_kyb_link_url",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (!biz?.company_name) {
    return json({
      success: false,
      error: "business_profiles missing company_name",
    }, 404);
  }

  if (isVerifiedStatus(biz.bridge_kyb_status)) {
    return json({
      success: true,
      data: { already_approved: true, bridge_kyb_status: "approved" },
    });
  }
  const existingCustomerId = biz.bridge_customer_id ||
    profile.bridge_customer_id;
  const providerAccountStatus = String(profile.bridge_account_status || "")
    .trim().toLowerCase();
  const providerKybStatus = String(biz.bridge_kyb_status || "").trim()
    .toLowerCase();
  const restartableBusinessVerification = [
    providerAccountStatus,
    providerKybStatus,
  ].some((status) => ["incomplete", "awaiting_ubo", "needs_ubos"].includes(status));
  const terminalBusinessVerification = [providerAccountStatus, providerKybStatus]
    .some((status) => ["rejected", "paused", "offboarded"].includes(status));
  const requiresTermsFirst = restartableBusinessVerification ||
    !terminalBusinessVerification;

  if (terminalBusinessVerification) {
    return json({
      success: false,
      code: "verification_not_restartable",
      error: "Business verification cannot be restarted. Contact support.",
    }, 409);
  }

  // Bridge has separate contracts for new and existing customers:
  //   - POST /kyc_links creates a new customer/link and does NOT accept customer_id.
  //   - GET /customers/{id}/kyc_link resumes an existing customer's hosted flow.
  // Re-posting an existing customer/email produces Bridge's generic 400 and blocks
  // actionable states such as awaiting_ubo from completing verification.
  let r: BridgeFetchResult;
  let link: ReturnType<typeof extractLink> = null;
  let resolvedTosStatus = "";

  // Existing businesses have two distinct hosted flows. Bridge is the source
  // of truth for whether ToS has been accepted: keep the customer inside the
  // mandatory ToS gate until acceptance, then fetch the current Persona URL.
  if (existingCustomerId) {
    const encodedCustomerId = encodeURIComponent(existingCustomerId);
    const customerResult = await bridgeGet(
      `/v0/customers/${encodedCustomerId}`,
    );
    const customer = customerResult.data?.data ?? customerResult.data;
    const termsAccepted = customer?.has_accepted_terms_of_service === true;
    if (customerResult.ok && phase === "terms" && termsAccepted) {
      return json({ success: true, data: { tos_accepted: true, tos_required: false } });
    }
    if (customerResult.ok && requiresTermsFirst) {
      // Return both hosted URLs for retryable existing businesses. Released
      // clients intentionally choose ToS first on the verification screen and
      // choose the external KYB URL from the Continue CTA inside that screen.
      // This keeps Persona out of the native WebView without requiring a new
      // mobile build or mutable server-side handoff state.
      const params = new URLSearchParams();
      params.set("redirect_uri", redirectUrl);
      const shouldReturnTerms = phase === "terms" || (phase === null && !termsAccepted);
      const shouldReturnKyb = phase === "kyb" || (phase === null && termsAccepted);
      const tosResult = shouldReturnTerms ? await bridgeGet(
        `/v0/customers/${encodedCustomerId}/tos_acceptance_link`,
      ) : null;
      const kycResult = shouldReturnKyb && termsAccepted ? await bridgeGet(
        `/v0/customers/${encodedCustomerId}/kyc_link?${params.toString()}`,
      ) : null;
      const effectiveTosResult = tosResult || customerResult;
      const tosPayload = effectiveTosResult.data?.data ?? effectiveTosResult.data;
      const tosUrl = typeof tosPayload?.url === "string"
        ? tosPayload.url
        : extractLink(effectiveTosResult.data)?.tos_link_url ||
          extractLink(customerResult.data)?.tos_link_url || null;
      if (!tosUrl && !kycResult) {
        console.error(
          `bridge-kyb-link: mandatory ToS URL missing user=${user.id} customer=${existingCustomerId} status=${effectiveTosResult.status}`,
        );
        return json({
          success: false,
          code: "terms_link_unavailable",
          error: "Could not open Terms of Service. Please try again.",
          bridge_request_id: effectiveTosResult.request_id,
        }, 502);
      }
      link = kycResult ? extractLink(kycResult.data) : null;
      if (link) {
        link.customer_id ||= existingCustomerId;
        link.tos_link_url = tosUrl || null;
      } else if (tosUrl) {
        link = {
          link_url: null,
          link_id: null,
          customer_id: existingCustomerId,
          tos_link_url: tosUrl,
        };
      }
      r = kycResult?.ok ? kycResult : effectiveTosResult;
      resolvedTosStatus = kycResult?.ok ? "approved" : "pending";
    } else {
      r = customerResult;
    }
  } else {
    r = {
      ok: false,
      status: 404,
      data: null,
      raw_text: "",
      error: "No existing Bridge customer",
    };
  }

  // Compatibility fallback only when the authoritative customer-resume route
  // is unavailable. Never prefer this cached-link lookup.
  if (
    (!r.ok || (!link?.link_url && !link?.tos_link_url)) &&
    biz.bridge_kyb_link_id
  ) {
    r = await bridgeGet(
      `/v0/kyc_links/${encodeURIComponent(biz.bridge_kyb_link_id)}`,
    );
    link = extractLink(r.data);
  }

  if (
    !existingCustomerId && (!r.ok || (!link?.link_url && !link?.tos_link_url))
  ) {
    const reqBody: Record<string, unknown> = {
      type: "business",
      email: profile.email,
      full_name: biz.company_name,
      endorsements: body.endorsements ?? ["base"],
      redirect_uri: redirectUrl,
    };
    r = await bridgePost(
      "/v0/kyc_links",
      reqBody,
      `borderpay:kyb:business:${KYB_LINK_CONTRACT_VERSION}:${user.id}`,
    );
    link = extractLink(r.data);
  }

  if (!r.ok && !link) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(
      `bridge-kyb-link: Bridge rejected rid=${
        r.request_id || ""
      } status=${r.status} body=${detail}`,
    );
    return json({
      success: false,
      error: `Business verification link request failed [${r.status}]: ${
        r.error || "unknown"
      }`,
      bridge_request_id: r.request_id,
      bridge_status: r.status,
    }, 502);
  }

  if (!link || (!link.link_url && !link.tos_link_url)) {
    console.error(
      `bridge-kyb-link: missing link/url body=${
        (r.raw_text || "").slice(0, 800)
      }`,
    );
    return json({
      success: false,
      error: `Business verification link response missing link URL`,
      bridge_request_id: r.request_id,
    }, 502);
  }

  let clientLinkUrl = link.link_url;
  if (link.link_url) {
    try {
      clientLinkUrl = verifiedHostedLink(customerOrigin, link.link_url);
    } catch (error) {
      console.error(
        `bridge-kyb-link: hosted URL rejected user=${user.id}: ${
          (error as Error).message
        }`,
      );
      return json({
        success: false,
        error: "Could not open secure business verification. Please try again.",
      }, 500);
    }
  }

  const customerId = link.customer_id || existingCustomerId || null;
  const bridgeKybStatus = extractKybStatus(r.data);
  const { error: updateErr } = await supa.from("business_profiles").update({
    ...(link.link_id ? { bridge_kyb_link_id: link.link_id } : {}),
    ...(clientLinkUrl ? { bridge_kyb_link_url: clientLinkUrl } : {}),
    ...(customerId ? { bridge_customer_id: customerId } : {}),
    ...(bridgeKybStatus ? { bridge_kyb_status: bridgeKybStatus } : {}),
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id);
  if (updateErr) {
    console.error(
      `bridge-kyb-link: business_profiles update failed for user=${user.id}: ${updateErr.message}`,
    );
    return json({
      success: false,
      error: `business_profiles update failed: ${updateErr.message}`,
      bridge_request_id: r.request_id,
    }, 500);
  }

  if (customerId) {
    const { error: profileUpdateErr } = await supa.from("user_profiles").update(
      {
        bridge_customer_id: customerId,
        updated_at: new Date().toISOString(),
      },
    ).eq("id", user.id);
    if (profileUpdateErr) {
      console.error(
        `bridge-kyb-link: user_profiles customer mirror failed for user=${user.id}: ${profileUpdateErr.message}`,
      );
      return json({
        success: false,
        error: `user_profiles update failed: ${profileUpdateErr.message}`,
        bridge_request_id: r.request_id,
      }, 500);
    }
  }

  const expires_at = r.data?.data?.expires_at || r.data?.expires_at ||
    r.data?.existing_kyc_link?.expires_at;
  const tosStatus = resolvedTosStatus || String(
    r.data?.data?.tos_status || r.data?.tos_status ||
      r.data?.existing_kyc_link?.tos_status || "",
  ).trim().toLowerCase();
  const tosRequired = Boolean(
    link.tos_link_url && tosStatus !== "approved" && tosStatus !== "accepted",
  );
  return json({
    success: true,
    data: {
      link_id: link.link_id,
      // The provider-hosted identity form must open top-level. Do not wrap it
      // in a Supabase or BorderPay HTML launcher.
      link_url: phase === "terms" ? null : clientLinkUrl,
      // Always lead an unverified business through the Terms page when the
      // hosted flow supplies it. The Continue CTA then opens KYB top-level.
      // Omit an already-accepted ToS URL so older native bundles proceed to
      // the actionable KYB link instead of reopening the Terms screen.
      tos_link_url: tosRequired ? link.tos_link_url : null,
      tos_required: tosRequired,
      tos_status: tosStatus || null,
      bridge_kyb_status: bridgeKybStatus,
      expires_at,
      reused: !r.ok ? true : undefined,
    },
  });
});
