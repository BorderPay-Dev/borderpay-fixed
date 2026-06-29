// bridge-ping — non-mutating sanity check for the BRIDGE_API_KEY secret.
//
// Auth: accepts EITHER the project's service-role token (exact string
// match against SUPABASE_SERVICE_ROLE_KEY), OR an admin user JWT
// validated through supabase.auth.getUser(token) AND found in admin_users.
//
// We deliberately do NOT decode JWT payloads ourselves — a caller could
// craft a payload with `{ role: "service_role" }` and bypass admin
// verification. Authorization is always derived from either a verified
// service-role secret comparison or a server-validated user JWT.
//
// Calls a read-only Bridge endpoint (GET /v0/customers?limit=1) and
// reports reachability + key_kind + latency WITHOUT echoing the key
// value back to the caller.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      ok: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({
      success: false,
      ok: false,
      code: "missing_bearer_token",
      error: "Authentication required",
    }, 401);
  }

  const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Authorize: service role (exact secret match) OR admin user ──────
  const isServiceRole = SUPABASE_SERVICE_ROLE.length > 0 && token === SUPABASE_SERVICE_ROLE;

  if (!isServiceRole) {
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !userInfo?.user) {
      return json({
        success: false,
        ok: false,
        code: "invalid_auth_token",
        error: "Unauthorized",
      }, 401);
    }

    const { data: adminRow } = await supa
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userInfo.user.id)
      .maybeSingle();
    if (!adminRow) {
      return json({
        success: false,
        ok: false,
        code: "admin_only",
        error: "Admin access required",
      }, 403);
    }
  }

  const apiKey  = Deno.env.get("BRIDGE_API_KEY") ?? "";
  const baseUrl = (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz").replace(/\/+$/, "");
  if (!apiKey) {
    return json({
      success: false,
      ok: false,
      code: "bridge_api_key_missing",
      error: "Bridge API key is not configured on this project.",
    }, 500);
  }

  // Surface only a prefix and the inferred environment — never the full key.
  const keyPrefix = apiKey.slice(0, 8) + "…";
  const keyKind   = apiKey.startsWith("sk-live") ? "live"
                  : apiKey.startsWith("sk-test") ? "sandbox"
                  : "unknown";

  const url = `${baseUrl}/v0/customers?limit=1`;
  const t0  = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method:  "GET",
      headers: {
        "Api-Key":    apiKey,
        "Accept":     "application/json",
        "User-Agent": "borderpay-edge/bridge-ping",
      },
    });
  } catch {
    return json({
      success: false,
      ok: false,
      code: "bridge_network_unreachable",
      key_prefix: keyPrefix,
      key_kind: keyKind,
      stage: "network",
      error: "Unable to reach Bridge endpoint right now.",
      latency_ms: Date.now() - t0,
    }, 502);
  }
  const latencyMs = Date.now() - t0;
  const requestId = res.headers.get("x-request-id") || res.headers.get("request-id") || null;
  const text = await res.text();
  let providerCode: string | null = null;

  let sampleCount: number | null = null;
  try {
    const parsed = JSON.parse(text || "{}");
    if (Array.isArray(parsed?.data))           sampleCount = parsed.data.length;
    else if (Array.isArray(parsed))            sampleCount = parsed.length;
    else if (typeof parsed?.count === "number") sampleCount = parsed.count;
    providerCode = typeof parsed?.code === "string"
      ? parsed.code
      : typeof parsed?.error_code === "string"
      ? parsed.error_code
      : null;
  } catch { /* ignore */ }

  if (!res.ok) {
    return json({
      success: false,
      ok:         false,
      code:       "bridge_http_error",
      stage:      "bridge_http",
      status:     res.status,
      key_prefix: keyPrefix,
      key_kind:   keyKind,
      base_url:   baseUrl,
      bridge_request_id: requestId,
      provider_code: providerCode,
      latency_ms: latencyMs,
      summary: {
        code: "bridge_http_error",
        status: res.status,
        key_kind: keyKind,
        bridge_request_id: requestId,
      },
      hint: res.status === 401 ? "Bridge rejected the key. Verify the secret value matches the intended environment."
          : res.status === 403 ? "Key valid but lacks scope. Check the API key permissions in the Bridge dashboard."
          : res.status === 429 ? "Rate limited. Retry shortly."
          : null,
    }, res.status === 401 ? 401 : 502);
  }

  return json({
    success: true,
    ok:           true,
    code:         "bridge_reachable",
    stage:        "reachable",
    status:       res.status,
    key_prefix:   keyPrefix,
    key_kind:     keyKind,
    base_url:     baseUrl,
    bridge_request_id: requestId,
    latency_ms:   latencyMs,
    sample_count: sampleCount,
    summary: {
      code: "bridge_reachable",
      status: res.status,
      key_kind: keyKind,
      bridge_request_id: requestId,
      sample_count: sampleCount,
    },
  });
});
