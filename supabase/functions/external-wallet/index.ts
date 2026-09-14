// external-wallet — manage a user's saved external stablecoin payout addresses.
//
// POST { action: 'add'|'remove'|'list', ... }. verify_jwt = true (config.toml).
//   add    : { label, chain, asset, address }  → validates address per chain
//   remove : { id }                            → soft-removes (status=removed)
//   list   : {}                                → active wallets (also readable via RLS)
//
// No money moves here — withdrawals go through bridge-transfer (gated +
// passcode/biometric). This endpoint only stores and validates destinations.
// New payouts use the crypto-to-crypto Transfers API directly; they must never
// create or route through a liquidation address.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { getFinancialAccessBlock } from "../_shared/account-access.ts";

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

const EVM = new Set(["base"]);
const SUPPORTED_CHAINS = new Set([...EVM, "tron"]);
const SUPPORTED_ASSETS = new Set(["USDC", "USDT"]);

function validAddress(chain: string, address: string): boolean {
  const a = (address || "").trim();
  if (EVM.has(chain))      return /^0x[a-fA-F0-9]{40}$/.test(a);
  if (chain === "tron")    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === "solana")  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return false;
}

async function findCurrentBridgeWallet(userId: string, asset: string, chain: string): Promise<{ id: string; address: string } | null> {
  const normalizedAsset = String(asset || "").toUpperCase();
  const normalizedChain = String(chain || "").toLowerCase();
  const activeStatuses = ["active", "enabled", "ready", "provisioned"];
  const select = "bridge_wallet_id,address,status,chain,currency,updated_at";
  const matches = (rows: any[] | null | undefined) => (rows || [])
    .filter((w) =>
      String(w?.bridge_wallet_id || "").trim()
      && String(w?.currency || "").toUpperCase() === normalizedAsset
      && String(w?.chain || "").toLowerCase() === normalizedChain
      && activeStatuses.includes(String(w?.status || "active").toLowerCase()))
    .sort((a, b) => Date.parse(String(b?.updated_at || "")) - Date.parse(String(a?.updated_at || "")));

  const { data: userRows } = await supa
    .from("bridge_wallets")
    .select(select)
    .eq("user_id", userId)
    .ilike("currency", normalizedAsset);
  const userMatch = matches(userRows)[0];
  if (userMatch?.bridge_wallet_id && userMatch?.address) {
    return { id: String(userMatch.bridge_wallet_id), address: String(userMatch.address) };
  }

  const { data: businessRows } = await supa
    .from("bridge_wallets")
    .select(select)
    .eq("business_user_id", userId)
    .ilike("currency", normalizedAsset);
  const businessMatch = matches(businessRows)[0];
  if (businessMatch?.bridge_wallet_id && businessMatch?.address) {
    return { id: String(businessMatch.bridge_wallet_id), address: String(businessMatch.address) };
  }
  return null;
}

type SavedWallet = Record<string, unknown> & { id?: string; address?: string };

// Older native builds require the legacy route fields to decide whether a
// saved wallet is selectable. Return an in-memory compatibility marker only;
// it is not a provider resource and is never persisted or sent to Bridge.
function withDirectTransferCompatibility(wallet: SavedWallet): SavedWallet {
  return {
    ...wallet,
    bridge_payment_route_id: "direct_crypto_transfer",
    bridge_payment_route_status: "active",
    bridge_payment_route_raw: {
      route_type: "crypto_to_crypto_transfer",
      to_address: String(wallet.address || ""),
      custom_developer_fee_percent: "0.0",
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action || "list");

  if (["repair_missing_routes", "audit_liquidation_route_fees", "repair_liquidation_route_fees"].includes(action)) {
    return json({
      success: false,
      code: "liquidation_routes_retired",
      error: "Liquidation-route maintenance is retired. External-wallet payouts use crypto-to-crypto transfers.",
    }, 410);
  }

  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  const accessBlock = await getFinancialAccessBlock(supa, user.id);
  if (accessBlock) return json({ success: false, ...accessBlock }, 423);

  if (action === "list") {
    const { data } = await supa
      .from("external_wallets")
      .select("id, label, chain, asset, address, bridge_payment_route_id, bridge_payment_route_status, bridge_payment_route_raw, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    return json({ success: true, data: { wallets: (data ?? []).map((wallet) => withDirectTransferCompatibility(wallet)) } });
  }

  if (action === "remove") {
    const id = String(body.id || "");
    if (!id) return json({ success: false, error: "id required" }, 400);
    await supa.from("external_wallets")
      .update({ status: "removed" })
      .eq("user_id", user.id)
      .eq("id", id);
    return json({ success: true, data: { removed: true, id } });
  }

  if (action === "add") {
    const label   = String(body.label || "").trim().slice(0, 40);
    const chain   = String(body.chain || "").trim().toLowerCase();
    const asset   = String(body.asset || "").trim().toUpperCase();
    const address = String(body.address || "").trim();

    if (!label)                          return json({ success: false, error: "Add a name for this wallet." }, 400);
    if (!SUPPORTED_CHAINS.has(chain))    return json({ success: false, error: "Supported withdrawal networks are Base for USDC and Tron for USDT." }, 400);
    if (!SUPPORTED_ASSETS.has(asset))    return json({ success: false, error: "Unsupported asset." }, 400);
    if ((asset === "USDC" && chain !== "base") || (asset === "USDT" && chain !== "tron")) {
      return json({ success: false, error: "Use USDC on Base or USDT on Tron." }, 400);
    }
    if (!validAddress(chain, address))   return json({ success: false, error: "That address isn't valid for the selected network." }, 422);

    const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
    if (!identity.ok) return json({ success: false, ...identity.failure }, 409);
    const profile = identity.context;
    if (!profile.bridge_customer_id) {
      return json({ success: false, code: "no_customer", error: "Complete account setup before saving a withdrawal wallet." }, 409);
    }
    if (profile.verification_status !== "approved") {
      return json({
        success: false,
        code: "kyc_not_approved",
        error: profile.account_type === "business" ? "KYB must be approved before saving withdrawal wallets." : "KYC must be approved before saving withdrawal wallets.",
      }, 409);
    }
    const sourceBridgeWalletId = await findCurrentBridgeWallet(user.id, asset, chain);
    if (!sourceBridgeWalletId) {
      return json({
        success: false,
        code: "source_wallet_required",
        error: `Add or refresh your ${asset} ${chain === "base" ? "Base" : "Tron"} wallet before saving this withdrawal wallet.`,
      }, 409);
    }

    // Persist only the customer's destination. Existing liquidation metadata
    // is deliberately left untouched for historical reconciliation, but it is
    // no longer read or used for new transfers.
    const { data, error } = await supa.from("external_wallets")
      .upsert({
        user_id: user.id,
        label,
        chain,
        asset,
        address,
        status: "active",
        bridge_payment_route_error: null,
      },
              { onConflict: "user_id,chain,address" })
      .select("id, label, chain, asset, address, bridge_payment_route_id, bridge_payment_route_status, bridge_payment_route_raw, created_at")
      .maybeSingle();
    if (error) return json({ success: false, error: "Could not save that wallet. Please try again." }, 500);
    return json({ success: true, data: { wallet: data ? withDirectTransferCompatibility(data) : data } });
  }

  return json({ success: false, error: "Unknown action" }, 400);
});
