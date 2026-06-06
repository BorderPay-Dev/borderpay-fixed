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

// Extract a kyc_link from Bridge's response body in any of the three
// shapes we have seen: top-level success, embedded data wrapper, or 400
// with existing_kyc_link. Returns null if no link is present anywhere.
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
  if (!bridgeOnboardingEnabled()) return json(bridgeOnboardingPausedBody(), 503);

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
    .select("id, email, full_name, account_type, country, phone, bridge_customer_id, bridge_kyc_link_id, bridge_kyc_link_url, bridge_kyc_status")
    .eq("id", user.id)
    .maybeSingle();
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

  if ((profile.bridge_kyc_status || "").toLowerCase() === "approved") {
    return json({ success: true, data: { already_approved: true, bridge_kyc_status: "approved" } });
  }
  if (profile.bridge_kyc_link_url) {
    return json({
      success: true,
      data: { link_id: profile.bridge_kyc_link_id, link_url: profile.bridge_kyc_link_url, reused: true },
    });
  }

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

  const idemSource = profile.bridge_customer_id || user.id;
  const r = await bridgePost(
    "/v0/kyc_links",
    reqBody,
    `borderpay:kyc:individual:${idemSource}`,
  );

  const link = extractLink(r.data);

  if (!r.ok && !link) {
    const detail = (r.raw_text || "").slice(0, 800);
    console.error(`bridge-kyc-link: Bridge rejected rid=${r.request_id || ""} status=${r.status} body=${detail}`);
    return json({
      success: false,
      error:   `Bridge createKycLink failed [${r.status}]: ${r.error || detail || "unknown"}`,
      bridge_request_id: r.request_id,
      bridge_status:     r.status,
      bridge_body:       detail,
    }, 502);
  }

  if (!link) {
    console.error(`bridge-kyc-link: missing link/url in success body=${(r.raw_text || "").slice(0, 800)}`);
    return json({
      success: false,
      error:   `Bridge createKycLink: missing link/url in response`,
      bridge_request_id: r.request_id,
    }, 502);
  }

  await supa.from("user_profiles").update({
    bridge_kyc_link_id:  link.link_id,
    bridge_kyc_link_url: link.link_url,
    bridge_kyc_status:   "pending",
    ...(link.customer_id ? { bridge_customer_id: link.customer_id } : {}),
    updated_at:          new Date().toISOString(),
  }).eq("id", user.id);

  const expires_at = r.data?.data?.expires_at || r.data?.expires_at || r.data?.existing_kyc_link?.expires_at;
  return json({
    success: true,
    data: { link_id: link.link_id, link_url: link.link_url, expires_at, reused: !r.ok ? true : undefined },
  });
});
