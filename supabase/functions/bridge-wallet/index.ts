// bridge-wallet — create a custodial stablecoin wallet (USDC, USDT, PYUSD,
//                  USDB, EURC, …) on a supported chain.
//
// POST body: { symbol: 'USDC'|'USDT'|'PYUSD'|'USDB'|'EURC',
//              chain:  'ETH'|'SOL'|'BSC'|'POLYGON'|'TRON'|'BASE'|'OPTIMISM'|'ARBITRUM' }
//
// Response: { success, data: { wallet_id, deposit_address, symbol, chain } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider, BridgeProviderError } from "../_shared/providers/bridge.ts";
import type { StablecoinSymbol, StablecoinChain } from "../_shared/providers/types.ts";
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
  isBridgeCustodialWalletSupported,
} from "../_shared/providers/bridge-country-policy.ts";
import { requireMinimumWalletBalance } from "../_shared/funding-gate.ts";
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

const SYMS:   readonly StablecoinSymbol[] = ["USDC", "USDT", "PYUSD", "USDB", "EURC"];
const CHAINS: readonly StablecoinChain[]  = ["ETH", "SOL", "BSC", "POLYGON", "TRON", "BASE", "OPTIMISM", "ARBITRUM"];

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
        expected_method: "POST",
      },
    }, 405);
  }

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
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

  let body: { symbol?: string; chain?: string };
  try { body = await req.json(); } catch {
    return json({
      success: false,
      code: "invalid_json_payload",
      error: "Invalid JSON payload",
      summary: {
        code: "invalid_json_payload",
      },
    }, 400);
  }
  const symbol = String(body.symbol || "USDC").toUpperCase() as StablecoinSymbol;
  const chain  = String(body.chain  || "ETH").toUpperCase()  as StablecoinChain;
  if (!SYMS.includes(symbol)) {
    return json({
      success: false,
      code: "invalid_symbol",
      error: "Unsupported stablecoin symbol.",
      supported_symbols: [...SYMS],
      summary: {
        code: "invalid_symbol",
        symbol: symbol || null,
      },
    }, 400);
  }
  if (!CHAINS.includes(chain)) {
    return json({
      success: false,
      code: "invalid_chain",
      error: "Unsupported stablecoin chain.",
      supported_chains: [...CHAINS],
      summary: {
        code: "invalid_chain",
        chain: chain || null,
      },
    }, 400);
  }

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    return json({
      success: false,
      ...identity.failure,
      summary: {
        code: identity.failure.code ?? "identity_invariant_violation",
      },
    }, 409);
  }
  const profile = identity.context;
  const isBusiness = profile.account_type === "business";

  // Paid gate: provisioning a wallet requires an activated (paid) plan. In the
  // Wise funnel KYC can be free, but money/account features stay paid-gated, so
  // an unpaid user gets `plan_required` → the app shows the activation popup.
  const __planGate = await requireMinimumWalletBalance(supa, user.id, {
    isBusiness,
    bridgeCustomerId: profile.bridge_customer_id,
  });
  if (!__planGate.allowed) return json(__planGate.body, __planGate.status);

  const productCountry = profile.country;
  const verificationStatus = profile.verification_status;

  // Defense-in-depth: even though Bridge customer creation already blocks
  // prohibited jurisdictions, a legacy/dirty row with a bridge_customer_id
  // for a prohibited-country user must NOT be able to provision a wallet.
  // Round-9: expanded from {CD} to full Prohibited set (18 codes) +
  // observability for Controlled traffic.
  if (isBridgeBlocked(productCountry)) {
    return json(bridgeCountryBlockResponse(productCountry!), 403);
  }
  if (!isBridgeCustodialWalletSupported(productCountry)) {
    return json({
      success: false,
      code: "wallet_country_not_supported",
      error: "Stablecoin wallets are not available for your country through BorderPay.",
      country: productCountry,
      summary: {
        code: "wallet_country_not_supported",
        country: productCountry || null,
      },
    }, 403);
  }
  logControlledBridgeTraffic("bridge-wallet", productCountry, user.id);
  if (!profile.bridge_customer_id) {
    return json({
      success: false,
      code: "no_customer",
      error: "Complete account setup before creating a wallet",
      required_state: "bridge_customer_created",
      summary: {
        code: "no_customer",
        required_state: "bridge_customer_created",
      },
    }, 409);
  }
  if (verificationStatus !== "approved") {
    return json({
      success: false,
      code: "kyc_not_approved",
      error: isBusiness ? "KYB not approved yet" : "KYC not approved yet",
      expected_verification_status: "approved",
      summary: {
        code: "kyc_not_approved",
        expected_verification_status: "approved",
      },
    }, 409);
  }

  // Idempotent on (user, symbol, chain)
  const { data: existing } = await supa
    .from("wallets")
    .select("id, bridge_wallet_id")
    .eq("user_id", user.id)
    .eq("currency", symbol)
    .eq("stablecoin_chain", chain)
    .eq("provider", "bridge")
    .maybeSingle();
  if (existing?.bridge_wallet_id) {
    return json({
      success: true,
      code: "wallet_already_exists",
      summary: {
        code: "wallet_already_exists",
        symbol,
        chain,
        already_exists: true,
      },
      data: { wallet_id: existing.bridge_wallet_id, symbol, chain, already_exists: true },
    });
  }

  try {
    const result = await bridgeProvider.createWallet({
      customer_id: profile.bridge_customer_id,
      symbol, chain,
    });

    // Write the table the dashboard reads (bridge_wallets) — this is what
    // BridgeWalletsCard lists. Previously we only wrote `wallets`, so created
    // wallets never appeared in the UI.
    const { error: bwErr } = await supa.from("bridge_wallets").insert({
      user_id:            user.id,
      ...(isBusiness ? { business_user_id: user.id } : {}),
      bridge_customer_id: profile.bridge_customer_id,
      bridge_wallet_id:   result.wallet_id,
      currency:           symbol,
      chain,
      address:            result.deposit_address,
      status:             "active",
    });
    // Legacy mirror for balance/ledger compatibility.
    const { error: wErr } = await supa.from("wallets").upsert({
      user_id:           user.id,
      currency:          symbol,
      provider:          "bridge",
      asset_type:        "stablecoin",
      stablecoin_chain:  chain,
      bridge_wallet_id:  result.wallet_id,
      virtual_account_number: result.deposit_address,  // deposit address goes here for stablecoins
      balance:           0,
      status:            "active",
    });
    if (bwErr || wErr) {
      // Bridge created the wallet; surface the persistence problem with the id
      // so the next sync reconciles it rather than silently losing it.
      return json({
        success: false,
        code:    "persistence_failed",
        error:   "Wallet was created but local sync failed. Please retry.",
        bridge_wallet_id: result.wallet_id,
        summary: {
          code: "persistence_failed",
          bridge_wallet_id: result.wallet_id,
        },
      }, 500);
    }

    return json({
      success: true,
      code: "wallet_created",
      summary: {
        code: "wallet_created",
        symbol,
        chain,
        already_exists: false,
      },
      data: { wallet_id: result.wallet_id, deposit_address: result.deposit_address, symbol, chain },
    });
  } catch (e) {
    if (e instanceof BridgeProviderError) {
      const code = String(e.bridge_code || "").toLowerCase();
      if (code === "has_not_accepted_tos") {
        return json({
          success: false,
          code: "tos_required",
          error: "Please accept Terms of Service before creating a wallet.",
          provider_code: code || undefined,
          bridge_request_id: e.request_id || undefined,
          summary: {
            code: "tos_required",
            bridge_request_id: e.request_id || null,
          },
        }, 409);
      }
      if (code === "requires_active_kyc_status") {
        return json({
          success: false,
          code: "kyc_not_approved",
          error: isBusiness
            ? "Business verification is required before creating a wallet."
            : "Identity verification is required before creating a wallet.",
          expected_verification_status: "approved",
          provider_code: code || undefined,
          bridge_request_id: e.request_id || undefined,
          summary: {
            code: "kyc_not_approved",
            expected_verification_status: "approved",
            bridge_request_id: e.request_id || null,
          },
        }, 409);
      }
      if (code === "missing_required_endorsements" || code === "endorsement_requirements_not_met") {
        return json({
          success: false,
          code: "endorsement_required",
          error: "Wallet creation is not enabled for your account yet.",
          provider_code: code || undefined,
          bridge_request_id: e.request_id || undefined,
          summary: {
            code: "endorsement_required",
            bridge_request_id: e.request_id || null,
          },
        }, 403);
      }
      return json({
        success: false,
        code: "wallet_provider_error",
        error: "Unable to create wallet right now. Please try again shortly.",
        provider_code: code || undefined,
        bridge_request_id: e.request_id || undefined,
        summary: {
          code: "wallet_provider_error",
          bridge_request_id: e.request_id || null,
        },
      }, 502);
    }
    return json({
      success: false,
      code: "wallet_provision_failed",
      error: "Unable to create wallet right now. Please try again shortly.",
      summary: {
        code: "wallet_provision_failed",
      },
    }, 502);
  }
});
