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

  const { data: profile } = await supa
    .from("user_profiles")
    .select("account_type, country, bridge_customer_id, bridge_kyc_status")
    .eq("id", user.id)
    .maybeSingle();
  const isBusiness = profile?.account_type === "business";

  // Paid gate: provisioning a wallet requires an activated (paid) plan. In the
  // Wise funnel KYC can be free, but money/account features stay paid-gated, so
  // an unpaid user gets `plan_required` → the app shows the activation popup.
  const __planGate = await requireMinimumWalletBalance(supa, user.id);
  if (!__planGate.allowed) return json(__planGate.body, __planGate.status);

  let productCountry = profile?.country ?? null;
  let verificationStatus = profile?.bridge_kyc_status ?? null;

  if (isBusiness) {
    const { data: biz } = await supa
      .from("business_profiles")
      .select("country, bridge_kyb_status")
      .eq("user_id", user.id)
      .maybeSingle();
    productCountry = biz?.country ?? productCountry;
    verificationStatus = biz?.bridge_kyb_status ?? verificationStatus;
  }

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
  if (!profile?.bridge_customer_id) {
    return json({ success: false, error: "Bridge customer required first", code: "no_customer" }, 409);
  }
  if (verificationStatus !== "approved") {
    return json({ success: false, error: isBusiness ? "KYB not approved yet" : "KYC not approved yet", code: "kyc_not_approved" }, 409);
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
    return json({ success: true, data: { wallet_id: existing.bridge_wallet_id, symbol, chain, already_exists: true } });
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
        error:   `Wallet created at Bridge (${result.wallet_id}) but local save failed: ${(bwErr || wErr)!.message}`,
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
