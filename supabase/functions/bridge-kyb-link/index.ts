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

type KybTraceStage =
  | "invoked"
  | "profile_loaded"
  | "bridge_request_sent"
  | "bridge_response_received"
  | "bridge_response_rejected"
  | "bridge_response_missing_link"
  | "db_update_success"
  | "db_update_failed"
  | "returned_success";

function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const [local, domain] = String(email).split("@");
  if (!domain) return null;
  const localMasked =
    local.length <= 2 ? `${local[0] || "*"}*` : `${local.slice(0, 2)}***`;
  return `${localMasked}@${domain}`;
}

function sanitizeErrorBody(value?: string | null): string | null {
  if (!value) return null;
  let out = String(value);
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]");
  out = out.replace(/bearer\s+[a-z0-9._-]+/gi, "bearer [redacted_token]");
  out = out.replace(/(api[-_ ]?key["'\s:=]+)[a-z0-9._-]+/gi, "$1[redacted_key]");
  out = out.replace(/(authorization["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted_auth]");
  out = out.replace(/\b[a-z0-9]{24,}\b/gi, "[redacted_opaque]");
  return out.slice(0, 600);
}

async function writeTrace(
  correlationId: string,
  stage: KybTraceStage,
  fields: {
    executionTimestamp?: string;
    userId?: string | null;
    email?: string | null;
    bridgeEndpoint?: string | null;
    httpStatus?: number | null;
    bridgeRequestId?: string | null;
    responseBody?: Record<string, unknown> | null;
    errorBody?: string | null;
    dbUpdateOk?: boolean | null;
    dbUpdateError?: string | null;
    elapsedMs?: number | null;
  } = {},
): Promise<void> {
  try {
    await supa.from("bridge_kyc_traces").insert({
      correlation_id: correlationId,
      execution_timestamp: fields.executionTimestamp || new Date().toISOString(),
      user_id: fields.userId || null,
      email: maskEmail(fields.email || null),
      stage,
      bridge_endpoint: fields.bridgeEndpoint || null,
      http_status: fields.httpStatus ?? null,
      bridge_request_id: fields.bridgeRequestId || null,
      response_body: fields.responseBody || null,
      error_body: sanitizeErrorBody(fields.errorBody || null),
      db_update_ok: fields.dbUpdateOk ?? null,
      db_update_error: sanitizeErrorBody(fields.dbUpdateError || null),
      elapsed_ms: fields.elapsedMs ?? null,
    });
  } catch {
    // tracing must never break KYB flow
  }
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

function mapKybLinkFailure(
  status: number,
  parsed: any,
): { status: number; code: string; error: string; provider_code?: string; expected_verification_status?: "approved" } {
  const providerCode = String(parsed?.code || parsed?.error_code || "").toLowerCase();
  switch (providerCode) {
    case "has_not_accepted_tos":
      return { status: 409, code: "tos_required", error: "Please accept Terms of Service before starting verification.", provider_code: providerCode };
    case "requires_active_kyc_status":
      return {
        status: 409,
        code: "kyb_not_approved",
        error: "Business verification is not active for this account yet.",
        provider_code: providerCode,
        expected_verification_status: "approved",
      };
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
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);
  const correlationId = crypto.randomUUID();
  const executionTimestamp = new Date().toISOString();
  const startedAtMs = Date.now();
  const elapsed = () => Date.now() - startedAtMs;

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
  await writeTrace(correlationId, "invoked", {
    executionTimestamp,
    userId: user.id,
    email: user.email ?? null,
    elapsedMs: elapsed(),
  });

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
  await writeTrace(correlationId, "profile_loaded", {
    executionTimestamp,
    userId: user.id,
    email: user.email ?? null,
    responseBody: {
      has_profile: Boolean(profile),
      account_type: profile?.account_type ?? null,
    },
    elapsedMs: elapsed(),
  });
  if (!profile) {
    return json({
      success: false,
      code: "profile_not_found",
      error: "User profile was not found",
    }, 404);
  }
  if (profile.account_type !== "business") {
    return json({
      success: false,
      code: "wrong_account_type",
      error: "Business verification is only available for business accounts.",
      expected_account_type: "business",
    }, 403);
  }
  if (isBridgeBlocked(profile.country)) {
    return json(bridgeCountryBlockResponse(profile.country!), 403);
  }
  logControlledBridgeTraffic("bridge-kyb-link", profile.country, user.id);
  if (!profile.email) {
    return json({
      success: false,
      code: "profile_email_missing",
      error: "Profile email is required to start verification",
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
    .select("company_name, registration_number, bridge_customer_id, bridge_kyb_status, bridge_kyb_link_id, bridge_kyb_link_url")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!biz?.company_name) {
    return json({
      success: false,
      code: "business_profile_incomplete",
      error: "Business profile is incomplete. Add company details before verification.",
    }, 404);
  }

  if (isVerifiedStatus(biz.bridge_kyb_status)) {
    return json({
      success: true,
      code: "kyb_already_approved",
      summary: { bridge_kyb_status: "approved", already_approved: true },
      data: { already_approved: true, bridge_kyb_status: "approved" },
    });
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
  await writeTrace(correlationId, "bridge_request_sent", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    bridgeEndpoint: "/v0/kyc_links",
    responseBody: {
      type: "business",
      has_customer_id: Boolean(biz.bridge_customer_id),
    },
    elapsedMs: elapsed(),
  });
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

  await writeTrace(correlationId, "bridge_response_received", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    bridgeEndpoint: "/v0/kyc_links",
    httpStatus: r.status,
    bridgeRequestId: r.request_id ?? null,
    responseBody: {
      has_data: Boolean(r.data),
      has_link: Boolean(link?.link_url || link?.tos_link_url),
      code: r.data?.code ?? null,
      message: r.data?.message ?? null,
    },
    errorBody: r.ok ? null : (r.raw_text || "").slice(0, 1200),
    elapsedMs: elapsed(),
  });

  if (!r.ok && !link) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(`bridge-kyb-link: Bridge rejected rid=${r.request_id || ""} status=${r.status} body=${detail}`);
    await writeTrace(correlationId, "bridge_response_rejected", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      bridgeEndpoint: "/v0/kyc_links",
      httpStatus: r.status,
      bridgeRequestId: r.request_id ?? null,
      responseBody: { code: r.data?.code ?? null, message: r.data?.message ?? null },
      errorBody: detail,
      elapsedMs: elapsed(),
    });
    const mapped = mapKybLinkFailure(r.status, r.data);
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      ...(mapped.expected_verification_status
        ? { expected_verification_status: mapped.expected_verification_status }
        : {}),
      provider_code: mapped.provider_code,
      bridge_request_id: r.request_id,
      bridge_status:     r.status,
      correlation_id:    correlationId,
    }, mapped.status);
  }

  if (!link || (!link.link_url && !link.tos_link_url)) {
    console.error(`bridge-kyb-link: missing link/url body=${(r.raw_text || "").slice(0, 800)}`);
    await writeTrace(correlationId, "bridge_response_missing_link", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      bridgeEndpoint: "/v0/kyc_links",
      httpStatus: r.status,
      bridgeRequestId: r.request_id ?? null,
      errorBody: (r.raw_text || "").slice(0, 1200),
      elapsedMs: elapsed(),
    });
    return json({
      success: false,
      code: "missing_verification_link",
      error: "Business verification link is temporarily unavailable. Please retry.",
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
    await writeTrace(correlationId, "db_update_failed", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      dbUpdateOk: false,
      dbUpdateError: updateErr.message,
      elapsedMs: elapsed(),
    });
    return json({
      success: false,
      code: "profile_sync_failed",
      error: "Verification link created but profile sync failed. Please retry.",
      bridge_request_id: r.request_id,
      correlation_id: correlationId,
    }, 500);
  }
  await writeTrace(correlationId, "db_update_success", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    dbUpdateOk: true,
    responseBody: { link_id_present: Boolean(link.link_id), link_url_present: Boolean(link.link_url), customer_id_present: Boolean(link.customer_id) },
    elapsedMs: elapsed(),
  });

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
  await writeTrace(correlationId, "returned_success", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    bridgeEndpoint: "/v0/kyc_links",
    httpStatus: r.status,
    bridgeRequestId: r.request_id ?? null,
    responseBody: {
      link_id: link.link_id,
      link_url_present: Boolean(link.link_url),
      tos_link_present: Boolean(link.tos_link_url),
      tos_status: tos_status_raw,
      tos_required,
      expires_at: expires_at ?? null,
      reused: !r.ok ? true : false,
    },
    elapsedMs: elapsed(),
  });
  return json({
    success: true,
    code: "kyb_link_ready",
    summary: {
      tos_required,
      reused: !r.ok ? true : false,
      expires_at: expires_at ?? null,
    },
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
