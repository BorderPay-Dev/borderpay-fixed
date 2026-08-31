import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-borderpay-migration-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) mismatch |= (a[i % Math.max(a.length, 1)] ?? 0) ^ (b[i % Math.max(b.length, 1)] ?? 0);
  return mismatch === 0;
}

async function bridgeRequest(method: "GET" | "DELETE", path: string) {
  const apiKey = String(Deno.env.get("BRIDGE_FEE_API_KEY") || Deno.env.get("BRIDGE_API_KEY") || "");
  if (!apiKey) return { ok: false, status: 0, request_id: null, error: "Bridge API key missing" };
  try {
    const response = await fetch(`https://api.bridge.xyz${path}`, {
      method,
      headers: { "Api-Key": apiKey, Accept: "application/json", "User-Agent": "borderpay-edge/1.0" },
    });
    const raw = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* keep redacted fallback */ }
    return {
      ok: response.ok,
      status: response.status,
      request_id: response.headers.get("x-request-id") || response.headers.get("request-id"),
      error: String(parsed.message || parsed.error || (response.ok ? "" : `HTTP ${response.status}`)),
    };
  } catch (error) {
    return { ok: false, status: 0, request_id: null, error: String((error as Error).message || "Bridge request failed") };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const expectedToken = String(Deno.env.get("BRIDGE_LIQUIDATION_MIGRATION_TOKEN") || "");
  const suppliedToken = String(req.headers.get("X-BorderPay-Migration-Token") || "");
  if (expectedToken.length < 32 || !constantTimeEqual(expectedToken, suppliedToken)) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  const action = String(body.action || "audit").toLowerCase();
  if (!new Set(["audit", "verify", "deactivate"]).has(action)) {
    return json({ success: false, error: "action must be audit, verify, or deactivate" }, 400);
  }
  const limit = Math.max(1, Math.min(Number(body.limit || 25), 50));
  const { data: wallets, error } = await supa
    .from("external_wallets")
    .select("id,user_id,bridge_payment_route_id,bridge_payment_route_status,created_at")
    .eq("asset", "USDC")
    .eq("chain", "base")
    .not("bridge_payment_route_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return json({ success: false, error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const wallet of wallets || []) {
    const walletId = String(wallet.id || "");
    const userId = String(wallet.user_id || "");
    const routeId = String(wallet.bridge_payment_route_id || "");
    if (!walletId || !userId || !routeId) continue;
    if (action === "audit") {
      results.push({ wallet_id: walletId, user_id: userId, route_id: routeId, status: wallet.bridge_payment_route_status });
      continue;
    }

    const identity = await loadAndAssertBridgeIdentityInvariant(supa, userId);
    if (!identity.ok || !identity.context.bridge_customer_id) {
      results.push({ wallet_id: walletId, route_id: routeId, result: "blocked", reason: identity.ok ? "missing_bridge_customer" : identity.failure.reason });
      continue;
    }
    const path = `/v0/customers/${encodeURIComponent(identity.context.bridge_customer_id)}/liquidation_addresses/${encodeURIComponent(routeId)}`;
    const response = await bridgeRequest(action === "verify" ? "GET" : "DELETE", path);
    if (action === "verify") {
      results.push({ wallet_id: walletId, route_id: routeId, result: response.ok ? "authenticated" : "provider_error", status: response.status, request_id: response.request_id || null, error: response.error || null });
      continue;
    }
    if (!response.ok && response.status !== 404) {
      results.push({ wallet_id: walletId, route_id: routeId, result: "provider_error", status: response.status, request_id: response.request_id || null, error: response.error || "Bridge deletion failed" });
      continue;
    }
    const { error: updateError } = await supa
      .from("external_wallets")
      .update({
        status: "removed",
        bridge_payment_route_status: "deactivated",
        bridge_payment_route_error: null,
      })
      .eq("id", walletId)
      .eq("user_id", userId);
    results.push(updateError
      ? { wallet_id: walletId, route_id: routeId, result: "local_error", error: updateError.message }
      : { wallet_id: walletId, route_id: routeId, result: response.status === 404 ? "already_absent_removed_locally" : "deactivated_and_removed" });
  }

  return json({
    success: true,
    action,
    matched: (wallets || []).length,
    results,
    has_more: (wallets || []).length === limit,
  });
});
