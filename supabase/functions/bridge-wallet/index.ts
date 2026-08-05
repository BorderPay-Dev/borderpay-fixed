// bridge-wallet — create a custodial stablecoin wallet (USDC, USDT, PYUSD,
//                  USDB, EURC, …) on a supported chain.
//
// POST body: { symbol: 'USDC'|'USDT'|'PYUSD'|'USDB'|'EURC',
//              chain:  'ETH'|'SOL'|'BSC'|'POLYGON'|'TRON'|'BASE'|'OPTIMISM'|'ARBITRUM' }
//
// Response: { success, data: { wallet_id, deposit_address, symbol, chain } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
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
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { symbol?: string; chain?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const symbol = String(body.symbol || "USDC").toUpperCase() as StablecoinSymbol;
  const chain  = String(body.chain  || "ETH").toUpperCase()  as StablecoinChain;
  if (!SYMS.includes(symbol))   return json({ success: false, error: `Unsupported symbol: ${symbol}` }, 400);
  if (!CHAINS.includes(chain))  return json({ success: false, error: `Unsupported chain: ${chain}` }, 400);

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    return json({ success: false, ...identity.failure }, 409);
  }
  const profile = identity.context;
  const isBusiness = profile.account_type === "business";

  // Legacy minimum-balance gate retained as a compatibility no-op.
  const __planGate = await requireMinimumWalletBalance(supa, user.id, {
    isBusiness,
    bridgeCustomerId: profile.bridge_customer_id ?? undefined,
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
    }, 403);
  }
  logControlledBridgeTraffic("bridge-wallet", productCountry, user.id);
  if (!profile.bridge_customer_id) {
    return json({ success: false, error: "Bridge customer required first", code: "no_customer" }, 409);
  }
  if (verificationStatus !== "approved") {
    return json({ success: false, error: isBusiness ? "KYB not approved yet" : "KYC not approved yet", code: "kyc_not_approved" }, 409);
  }

  // Idempotent on (user, symbol, chain)
  const { data: existing } = await supa
    .from("bridge_wallets")
    .select("bridge_wallet_id,address,status")
    .or(`user_id.eq.${user.id},business_user_id.eq.${user.id}`)
    .eq("bridge_customer_id", profile.bridge_customer_id)
    .ilike("currency", symbol)
    .ilike("chain", chain)
    .maybeSingle();
  const existingActive = String(existing?.status || "").toLowerCase() === "active";
  if (existing?.bridge_wallet_id && existingActive && existing.address) {
    return json({
      success: true,
      data: {
        wallet_id: existing.bridge_wallet_id,
        deposit_address: existing.address,
        symbol,
        chain,
        already_exists: true,
      },
    });
  }
  if (existing?.bridge_wallet_id && !existingActive) {
    return json({
      success: false,
      code: "wallet_not_active",
      error: `Existing ${symbol}/${chain} wallet is ${existing.status || "not active"}.`,
    }, 409);
  }

  try {
    const result = await bridgeProvider.createWallet({
      customer_id: profile.bridge_customer_id,
      symbol, chain,
    });

    // Write the table the dashboard reads (bridge_wallets) — this is what
    // BridgeWalletsCard lists. Previously we only wrote `wallets`, so created
    // wallets never appeared in the UI.
    const { error: bwErr } = await supa.from("bridge_wallets").upsert({
      user_id:            user.id,
      ...(isBusiness ? { business_user_id: user.id } : {}),
      bridge_customer_id: profile.bridge_customer_id,
      bridge_wallet_id:   result.wallet_id,
      currency:           symbol,
      chain:              chain.toLowerCase(),
      address:            result.deposit_address,
      status:             "active",
    }, { onConflict: "bridge_wallet_id", ignoreDuplicates: false });
    if (bwErr) {
      // Bridge created the wallet; surface the persistence problem with the id
      // so the next sync reconciles it rather than silently losing it.
      return json({
        success: false,
        code:    "persistence_failed",
        error:   `Wallet created at Bridge (${result.wallet_id}) but local save failed: ${bwErr.message}`,
        bridge_wallet_id: result.wallet_id,
      }, 500);
    }

    return json({
      success: true,
      data: { wallet_id: result.wallet_id, deposit_address: result.deposit_address, symbol, chain },
    });
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
