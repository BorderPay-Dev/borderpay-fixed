// bridge-provision-stablecoins — MANUAL-ONLY compatibility endpoint.
//
// Product contract: stablecoin wallets must never be auto-created after KYC/KYB
// approval. Users add USDC/USDT themselves from Wallet/Dashboard.
//
// This endpoint is kept for backward-compat callers, but it is now an explicit
// no-op and never provisions wallets.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";

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
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
      summary: {
        code: "method_not_allowed",
      },
    }, 405);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({
      success: false,
      code: "missing_bearer_token",
      error: "Authentication required",
      summary: {
        code: "missing_bearer_token",
      },
    }, 401);
  }
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) {
    return json({
      success: false,
      code: "invalid_auth_token",
      error: "Unauthorized",
      summary: {
        code: "invalid_auth_token",
      },
    }, 401);
  }

  const noop = (reason: string, context?: Record<string, unknown>) =>
    json({
      success: true,
      code: "stablecoin_provisioning_skipped",
      summary: {
        code: "stablecoin_provisioning_skipped",
        skipped: reason,
        wallet_count: 0,
      },
      data: { wallets: [], skipped: reason, ...(context || {}) },
    });

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    if (identity.failure.reason === "approved_without_customer_id") {
      return json({
        success: false,
        ...identity.failure,
        summary: {
          code: identity.failure.code ?? "approved_without_customer_id",
        },
      }, 409);
    }
    return noop(identity.failure.reason);
  }

  return noop("manual_only", {
    message: "Stablecoin wallets are manual-add only. Use Wallet -> Add -> Stablecoin Wallet.",
  });
});
