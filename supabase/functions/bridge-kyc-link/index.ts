// bridge-kyc-link v6 — embedded /v0/kyc_links flow (no /v0/customers pre-create).
//
// SOURCE OF TRUTH for what is deployed at version 6. Earlier vendored
// versions of this file used `bridgeProvider.createCustomer()` followed
// by `createKycLink()`. That path failed with HTTP 400/502 because
// Bridge's /v0/customers requires signed_agreement_id, birth_date, and
// a full address up-front — fields the user only enters on Bridge's
// hosted page. Every signup attempt produced an orphaned Bridge
// customer or no customer at all.
//
// Current contract:
//   • Build the Bridge `/v0/kyc_links` body with `type=individual`,
//     `email`, `full_name` UNCONDITIONALLY. Bridge requires those even
//     when `customer_id` is supplied (confirmed via 400 response body:
//     `{"code":"invalid_parameters","source":{"key":{"email":"is missing"}}}`).
//   • Only attach `customer_id` when we already have one in
//     user_profiles.bridge_customer_id (orphan from a previous attempt).
//   • Idempotency key: `borderpay:kyc:individual:<customer_id || user_id>`.
//   • Handle Bridge's 400-with-`existing_kyc_link` as success — when the
//     same email already has a KYC link, Bridge returns the existing one
//     in the response body for convenience.
//   • Surface bridge_request_id, bridge_status, and the first 800 bytes
//     of Bridge's raw body on any unrecoverable failure so the
//     operator can debug from edge-function logs.
//
// Country policy: DRC (CD) returns 403 country_not_supported. Account-type
// guard returns 403 wrong_account_type for business accounts (they use
// bridge-kyb-link). Approved users short-circuit to already_approved.
// Pre-existing bridge_kyc_link_url short-circuits to reused.
//
// Deploy via MCP `deploy_edge_function` (verify_jwt=false; the function
// validates the JWT itself via supabase.auth.getUser). This file is the
// canonical source the repo uses to validate that deploy matches what
// reviewers see in git.

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

interface ExtractedLinks {
  kyc_link_url: string | null;
  kyc_link_id: string | null;
  customer_id?: string;
  tos_link_url: string | null;
}

type TraceStage =
  | "invoked"
  | "profile_loaded"
  | "profile_bootstrap_failed"
  | "bridge_request_sent"
  | "bridge_response_received"
  | "bridge_response_rejected"
  | "bridge_response_missing_link"
  | "db_update_success"
  | "db_update_failed"
  | "returned_success";

function sanitizeTracePayload(body: { redirect_url?: string; endorsements?: string[] }, hasCustomerId: boolean): Record<string, unknown> {
  return {
    has_redirect_url: Boolean(body?.redirect_url),
    endorsements: Array.isArray(body?.endorsements) ? body.endorsements.slice(0, 10) : ["base"],
    has_customer_id: hasCustomerId,
  };
}

function sanitizeResponseBody(data: any): Record<string, unknown> {
  return {
    has_data: Boolean(data),
    has_link: Boolean(data?.kyc_link?.url || data?.data?.kyc_link?.url || data?.existing_kyc_link?.url || data?.url || data?.data?.url),
    has_customer_id: Boolean(data?.customer_id || data?.data?.customer_id || data?.existing_kyc_link?.customer_id),
    code: data?.code ?? null,
    message: data?.message ?? null,
  };
}

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
  // redact emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]");
  // redact bearer/api-key style tokens
  out = out.replace(/bearer\s+[a-z0-9._-]+/gi, "bearer [redacted_token]");
  out = out.replace(/(api[-_ ]?key["'\s:=]+)[a-z0-9._-]+/gi, "$1[redacted_key]");
  out = out.replace(/(authorization["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted_auth]");
  // redact very long opaque tokens/ids
  out = out.replace(/\b[a-z0-9]{24,}\b/gi, "[redacted_opaque]");
  return out.slice(0, 600);
}

async function writeTrace(
  correlationId: string,
  stage: TraceStage,
  fields: {
    executionTimestamp?: string;
    userId?: string | null;
    email?: string | null;
    bridgeEndpoint?: string | null;
    httpStatus?: number | null;
    bridgeRequestId?: string | null;
    requestPayload?: Record<string, unknown> | null;
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
      request_payload: fields.requestPayload || null,
      response_body: fields.responseBody || null,
      error_body: sanitizeErrorBody(fields.errorBody || null),
      db_update_ok: fields.dbUpdateOk ?? null,
      db_update_error: sanitizeErrorBody(fields.dbUpdateError || null),
      elapsed_ms: fields.elapsedMs ?? null,
    });
  } catch (traceErr) {
    console.error(
      "bridge-kyc-link trace insert failed",
      JSON.stringify({
        correlation_id: correlationId,
        stage,
        error: traceErr instanceof Error ? traceErr.message : String(traceErr),
      }),
    );
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
    error:      res.ok ? undefined : (parsed?.message || `HTTP ${res.status}`),
    request_id: res.headers.get("x-request-id") || undefined,
  };
}

async function bridgeGet(path: string, correlationId?: string): Promise<BridgeFetchResult> {
  if (!BRIDGE_API_KEY) {
    return { ok: false, status: 0, data: null, raw_text: "BRIDGE_API_KEY missing", error: "BRIDGE_API_KEY missing" };
  }
  const res = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "Api-Key":      BRIDGE_API_KEY,
      "Accept":       "application/json",
      ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
      "User-Agent":   "borderpay-edge/1.0",
    },
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

// Extract a kyc_link from Bridge's response body in any of the three
// shapes we have seen: top-level success, embedded data wrapper, or 400
// with existing_kyc_link. Returns null if no link is present anywhere.
function extractLinks(parsed: any): ExtractedLinks | null {
  if (!parsed) return null;
  const candidates = [parsed?.data, parsed, parsed?.existing_kyc_link].filter(Boolean);
  for (const c of candidates) {
    const kycLinkUrl: string | null =
      c?.kyc_link?.url ||
      (typeof c?.kyc_link === "string" ? c.kyc_link : null) ||
      c?.url ||
      c?.link;
    const linkId: string | null  = c?.kyc_link?.id || c?.id;
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

function bridgeErrorLooksLikeTosRequirement(raw: string): boolean {
  const t = String(raw || "").toLowerCase();
  return (
    t.includes("signed_agreement_id")
    || t.includes("tos")
    || t.includes("terms of service")
    || t.includes("agreement")
  );
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

  const correlationId = crypto.randomUUID();
  const executionTimestamp = new Date().toISOString();
  const startedAtMs = Date.now();
  const elapsed = () => Date.now() - startedAtMs;
  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
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

  let { data: profile } = await supa
    .from("user_profiles")
    .select("id, email, full_name, account_type, country, phone, bridge_customer_id, bridge_kyc_link_id, bridge_kyc_link_url, bridge_kyc_status, bridge_account_status")
    .eq("id", user.id)
    .maybeSingle();
  await writeTrace(correlationId, "profile_loaded", {
    executionTimestamp,
    userId: user.id,
    email: user.email ?? null,
    responseBody: {
      has_profile: Boolean(profile),
      account_type: profile?.account_type ?? null,
      has_bridge_customer_id: Boolean(profile?.bridge_customer_id),
      bridge_kyc_status: profile?.bridge_kyc_status ?? null,
    },
    elapsedMs: elapsed(),
  });

  // Legacy compatibility: some pre-Bridge users can authenticate without a
  // normalized user_profiles row. Bootstrap the minimum row so they can start
  // Bridge KYC instead of failing hard.
  if (!profile) {
    const fallbackAccountType = String(user.user_metadata?.account_type || "individual").toLowerCase() === "business"
      ? "business"
      : "individual";
    const fallbackEmail = user.email || null;
    if (!fallbackEmail) {
      return json({ success: false, error: "Profile missing email — cannot start verification" }, 400);
    }
    const upsertPayload: Record<string, unknown> = {
      id: user.id,
      email: fallbackEmail,
      full_name: String(user.user_metadata?.full_name || user.user_metadata?.name || "User"),
      account_type: fallbackAccountType,
      country: String(user.user_metadata?.country || user.user_metadata?.country_code || "KE").toUpperCase(),
      phone: user.phone || null,
      kyc_status: "pending",
      bridge_kyc_status: "pending",
      bridge_account_status: "pending",
      updated_at: new Date().toISOString(),
    };
    const { data: seeded, error: seedErr } = await supa
      .from("user_profiles")
      .upsert(upsertPayload, { onConflict: "id" })
      .select("id, email, full_name, account_type, country, phone, bridge_customer_id, bridge_kyc_link_id, bridge_kyc_link_url, bridge_kyc_status, bridge_account_status")
      .eq("id", user.id)
      .maybeSingle();
    if (seedErr) {
      await writeTrace(correlationId, "profile_bootstrap_failed", {
        executionTimestamp,
        userId: user.id,
        email: user.email ?? null,
        errorBody: seedErr.message,
        elapsedMs: elapsed(),
      });
      return json({ success: false, error: `user_profiles bootstrap failed: ${seedErr.message}` }, 500);
    }
    profile = seeded as any;
  }
  if (!profile) return json({ success: false, error: "user_profiles row missing" }, 404);
  if (profile.account_type === "business") {
    return json({ success: false, error: "KYC is only for individual accounts. Use bridge-kyb-link.", code: "wrong_account_type" }, 403);
  }
  if (isBridgeBlocked(profile.country)) {
    return json(bridgeCountryBlockResponse(profile.country!), 403);
  }
  logControlledBridgeTraffic("bridge-kyc-link", profile.country, user.id);
  if (!profile.email) {
    return json({ success: false, error: "Profile missing email — cannot start verification" }, 400);
  }

  if (isVerifiedStatus(profile.bridge_kyc_status) || isVerifiedStatus(profile.bridge_account_status)) {
    return json({ success: true, data: { already_approved: true, bridge_kyc_status: "approved" } });
  }
  // Do not short-circuit to cached link_url: old links can expire and trap users
  // in repeated verification errors. Always ask Bridge for the current link state.

  // Build the /v0/kyc_links body. email + full_name are unconditional.
  // customer_id is attached only when we have one from a prior attempt.
  const reqBody: Record<string, unknown> = {
    type:         "individual",
    email:        profile.email,
    full_name:    profile.full_name || "User",
    endorsements: body.endorsements ?? ["base"],
    redirect_uri: body.redirect_url || `${APP_URL}/onboarding/kyc-complete`,
  };
  if (profile.bridge_customer_id) reqBody.customer_id = profile.bridge_customer_id;
  await writeTrace(correlationId, "bridge_request_sent", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    bridgeEndpoint: "/v0/kyc_links",
    requestPayload: sanitizeTracePayload(body, Boolean(profile.bridge_customer_id)),
    elapsedMs: elapsed(),
  });

  const idemSource = profile.bridge_customer_id || user.id;
  let r = await bridgePost(
    "/v0/kyc_links",
    reqBody,
    `borderpay:kyc:individual:${idemSource}`,
    correlationId,
  );

  let links = extractLinks(r.data);

  // Legacy safety: if a stale/invalid bridge_customer_id is stored locally,
  // Bridge can reject the request. Retry once without customer_id using the
  // embedded-customer hosted KYC flow (Bridge-supported) to unblock users.
  if (!r.ok && !links && profile.bridge_customer_id) {
    const fallbackBody = { ...reqBody };
    delete fallbackBody.customer_id;
    await writeTrace(correlationId, "bridge_request_sent", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      bridgeEndpoint: "/v0/kyc_links",
      requestPayload: {
        ...sanitizeTracePayload(body, false),
        retry_without_customer_id: true,
      },
      elapsedMs: elapsed(),
    });
    r = await bridgePost(
      "/v0/kyc_links",
      fallbackBody,
      `borderpay:kyc:individual:fallback:${user.id}`,
      correlationId,
    );
    links = extractLinks(r.data);
    await writeTrace(correlationId, "bridge_response_received", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      bridgeEndpoint: "/v0/kyc_links",
      httpStatus: r.status,
      bridgeRequestId: r.request_id ?? null,
      responseBody: {
        ...sanitizeResponseBody(r.data),
        retry_without_customer_id: true,
      },
      errorBody: r.ok ? null : (r.raw_text || "").slice(0, 1200),
      elapsedMs: elapsed(),
    });
  }
  await writeTrace(correlationId, "bridge_response_received", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    bridgeEndpoint: "/v0/kyc_links",
    httpStatus: r.status,
    bridgeRequestId: r.request_id ?? null,
    responseBody: sanitizeResponseBody(r.data),
    errorBody: r.ok ? null : (r.raw_text || "").slice(0, 1200),
    elapsedMs: elapsed(),
  });

  if (!r.ok && !links && profile.bridge_customer_id && bridgeErrorLooksLikeTosRequirement(r.raw_text || r.error || "")) {
    const tosRes = await bridgeGet(
      `/v0/customers/${encodeURIComponent(profile.bridge_customer_id)}/tos_acceptance_link`,
      correlationId,
    );
    const tosUrl =
      tosRes?.data?.url ||
      tosRes?.data?.data?.url ||
      null;
    if (tosRes.ok && tosUrl) {
      await writeTrace(correlationId, "returned_success", {
        executionTimestamp,
        userId: user.id,
        email: profile.email,
        bridgeEndpoint: `/v0/customers/${profile.bridge_customer_id}/tos_acceptance_link`,
        httpStatus: tosRes.status,
        bridgeRequestId: tosRes.request_id ?? null,
        responseBody: { tos_link_only: true, tos_link_url_present: true },
        elapsedMs: elapsed(),
      });
      return json({
        success: true,
        data: {
          link_id: null,
          link_url: null,
          tos_link_url: String(tosUrl),
          tos_required: true,
          correlation_id: correlationId,
        },
      });
    }
  }

  if (!r.ok && !links) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(`bridge-kyc-link: Bridge rejected rid=${r.request_id || ""} status=${r.status} body=${detail}`);
    await writeTrace(correlationId, "bridge_response_rejected", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      bridgeEndpoint: "/v0/kyc_links",
      httpStatus: r.status,
      bridgeRequestId: r.request_id ?? null,
      responseBody: sanitizeResponseBody(r.data),
      errorBody: detail,
      elapsedMs: elapsed(),
    });
    return json({
      success: false,
      error:   `Verification link request failed [${r.status}]: ${r.error || detail || "unknown"}`,
      bridge_request_id: r.request_id,
      bridge_status:     r.status,
      bridge_body:       detail,
    }, 502);
  }

  if (!links) {
    console.error(`bridge-kyc-link: missing link/url in success body=${(r.raw_text || "").slice(0, 800)}`);
    await writeTrace(correlationId, "bridge_response_missing_link", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      bridgeEndpoint: "/v0/kyc_links",
      httpStatus: r.status,
      bridgeRequestId: r.request_id ?? null,
      responseBody: sanitizeResponseBody(r.data),
      errorBody: (r.raw_text || "").slice(0, 1200),
      elapsedMs: elapsed(),
    });
    return json({
      success: false,
      error:   `Verification link response missing link URL`,
      bridge_request_id: r.request_id,
    }, 502);
  }

  const { error: updateErr } = await supa.from("user_profiles").update({
    bridge_kyc_link_id:  links.kyc_link_id,
    bridge_kyc_link_url: links.kyc_link_url,
    bridge_kyc_status:   "pending",
    ...(links.customer_id ? { bridge_customer_id: links.customer_id } : {}),
    updated_at:          new Date().toISOString(),
  }).eq("id", user.id);
  if (updateErr) {
    await writeTrace(correlationId, "db_update_failed", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      dbUpdateOk: false,
      dbUpdateError: updateErr.message,
      responseBody: { link_id_present: Boolean(links.kyc_link_id), link_url_present: Boolean(links.kyc_link_url), customer_id_present: Boolean(links.customer_id), tos_link_present: Boolean(links.tos_link_url) },
      elapsedMs: elapsed(),
    });
  } else {
    await writeTrace(correlationId, "db_update_success", {
      executionTimestamp,
      userId: user.id,
      email: profile.email,
      dbUpdateOk: true,
      responseBody: { link_id_present: Boolean(links.kyc_link_id), link_url_present: Boolean(links.kyc_link_url), customer_id_present: Boolean(links.customer_id), tos_link_present: Boolean(links.tos_link_url) },
      elapsedMs: elapsed(),
    });
  }

  const expires_at = r.data?.data?.expires_at || r.data?.expires_at || r.data?.existing_kyc_link?.expires_at;
  await writeTrace(correlationId, "returned_success", {
    executionTimestamp,
    userId: user.id,
    email: profile.email,
    bridgeEndpoint: "/v0/kyc_links",
    httpStatus: r.status,
    bridgeRequestId: r.request_id ?? null,
    responseBody: {
      link_id: links.kyc_link_id,
      link_url_present: Boolean(links.kyc_link_url),
      tos_link_present: Boolean(links.tos_link_url),
      expires_at: expires_at ?? null,
      reused: !r.ok ? true : false,
    },
    elapsedMs: elapsed(),
  });
  return json({
    success: true,
    data: {
      link_id: links.kyc_link_id,
      link_url: links.kyc_link_url,
      tos_link_url: links.tos_link_url,
      expires_at,
      reused: !r.ok ? true : undefined,
      correlation_id: correlationId,
    },
  });
});
