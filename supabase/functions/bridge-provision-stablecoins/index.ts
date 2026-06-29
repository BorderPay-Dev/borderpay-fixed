// bridge-provision-stablecoins — ensure an activated, KYC-approved customer has
// their base stablecoin wallets (USDC on Base, USDT on Tron) so they can receive
// stablecoin AND so a virtual account has a settlement destination ready.
//
// Idempotent: creates a wallet only if that (currency, chain) is missing; if it
// already exists (incl. created on the Bridge dashboard once synced), it's a
// no-op. Safe to call on every dashboard load — ineligible users get a silent
// no-op (NO plan_required 402, so it never triggers the activation popup).
//
// POST {} → { success, data: { wallets: [{symbol, chain, address, already}] } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { isBridgeBlocked, isBridgeCustodialWalletSupported } from "../_shared/providers/bridge-country-policy.ts";
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

// The base set every activated user gets. USDC-Base also settles USD/EUR/GBP
// virtual accounts; USDT-Tron is the popular receive rail.
const DEFAULTS: ReadonlyArray<{ symbol: string; chain: string }> = [
  { symbol: "USDC", chain: "BASE" },
  { symbol: "USDT", chain: "TRON" },
];


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
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
    // Keep this endpoint best-effort/noise-free for ineligible users, but never
    // hide an approved identity invariant break.
    if (identity.failure.reason === "approved_without_customer_id") {
      return json({ success: false, ...identity.failure }, 409);
    }
    return noop(identity.failure.reason);
  }
  const profile = identity.context;
  const isBusiness = profile.account_type === "business";

  // Silent no-ops for ineligible users — never an error, never a 402.
  if (!profile.bridge_customer_id) {
    return noop("no_customer", {
      required_state: "bridge_customer_created",
    });
  }
  const verification = profile.verification_status;
  if (verification !== "approved") {
    const verificationLabel = isBusiness ? "KYB" : "KYC";
    return noop("kyc_not_approved", {
      expected_verification_status: "approved",
      verification_label: verificationLabel,
    });
  }
  if (isBridgeBlocked(profile?.country) || !isBridgeCustodialWalletSupported(profile?.country)) {
    return noop("country_unsupported", {
      country: profile?.country || null,
    });
  }

  const ownerCols = isBusiness ? { user_id: user.id, business_user_id: user.id } : { user_id: user.id };
  const out: Array<{ symbol: string; chain: string; address: string | null; already: boolean }> = [];

  for (const { symbol, chain } of DEFAULTS) {
    // Idempotent: skip if this (currency, chain) already exists for the user.
    const { data: existing } = await supa
      .from("bridge_wallets")
      .select("address")
      .eq("user_id", user.id)
      .ilike("currency", symbol)
      .ilike("chain", chain)
      .maybeSingle();
    if (existing) { out.push({ symbol, chain: chain.toLowerCase(), address: existing.address, already: true }); continue; }

    try {
      const created = await bridgeProvider.createWallet({ customer_id: profile.bridge_customer_id, symbol: symbol as any, chain: chain as any });
      await supa.from("bridge_wallets").insert({
        ...ownerCols,
        bridge_customer_id: profile.bridge_customer_id,
        bridge_wallet_id:   created.wallet_id,
        currency:           symbol,
        chain:              chain.toLowerCase(),
        address:            created.deposit_address,
        status:             "active",
      });
      out.push({ symbol, chain: chain.toLowerCase(), address: created.deposit_address, already: false });
    } catch (e) {
      // One failure shouldn't block the other; report best-effort.
      console.warn(`provision ${symbol}/${chain}: ${(e as Error).message}`);
    }
  }

  return json({
    success: true,
    code: "stablecoin_provisioning_completed",
    summary: {
      code: "stablecoin_provisioning_completed",
      wallet_count: out.length,
    },
    data: { wallets: out, wallet_count: out.length },
  });
});
