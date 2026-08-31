// external-wallet — manage a user's saved external stablecoin payout addresses.
//
// POST { action: 'add'|'remove'|'list', ... }. verify_jwt = true (config.toml).
//   add    : { label, chain, asset, address }  → validates address per chain
//   remove : { id }                            → soft-removes (status=removed)
//   list   : {}                                → active wallets (also readable via RLS)
//
// No money moves here — withdrawals go through bridge-transfer (gated +
// passcode/biometric). This stores/validates destinations and registers the
// reusable Bridge liquidation route for the saved destination.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { BRIDGE_DEVELOPER_FEE_PERCENT } from "../_shared/fees/schedule.ts";
import type { BridgePaymentRail, StablecoinSymbol } from "../_shared/providers/types.ts";

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
const ROUTE_DEVELOPER_FEE_PERCENT = BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_route;

function validAddress(chain: string, address: string): boolean {
  const a = (address || "").trim();
  if (EVM.has(chain))      return /^0x[a-fA-F0-9]{40}$/.test(a);
  if (chain === "tron")    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
  if (chain === "solana")  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return false;
}

function routeStatusUsable(status: unknown): boolean {
  const normalized = String(status || "active").trim().toLowerCase();
  return !["failed", "removed", "disabled", "inactive", "closed", "deactivated", "canceled", "cancelled"].includes(normalized);
}

function jwtRole(token: string): string {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return "";
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    const parsed = JSON.parse(atob(padded));
    return String(parsed?.role || parsed?.app_metadata?.role || "").trim();
  } catch {
    return "";
  }
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

async function createCryptoRoute(params: {
  userId: string;
  bridgeCustomerId: string;
  asset: string;
  chain: string;
  address: string;
}): Promise<{ routeId: string; routeStatus: string; routeRaw: unknown }> {
  const sourceWallet = await findCurrentBridgeWallet(params.userId, params.asset, params.chain);
  if (!sourceWallet?.address) {
    throw new Error("source_wallet_required");
  }
  const route = await bridgeProvider.createLiquidationAddress({
    customer_id: params.bridgeCustomerId,
    currency: params.asset as StablecoinSymbol,
    chain: params.chain as BridgePaymentRail,
    destination_payment_rail: params.chain as BridgePaymentRail,
    destination_currency: params.asset as StablecoinSymbol,
    destination_address: params.address,
    return_address: sourceWallet.address,
    developer_fee_percent: ROUTE_DEVELOPER_FEE_PERCENT > 0 ? String(ROUTE_DEVELOPER_FEE_PERCENT) : undefined,
    idempotency_key: `borderpay:external-wallet-liquidation:v1:${params.userId}:${params.asset}:${params.chain}:${params.address}`,
  });
  const raw = route.raw && typeof route.raw === "object" ? route.raw as Record<string, unknown> : {};
  return {
    routeId: String(raw.id || route.liquidation_address_id || ""),
    routeStatus: String(raw.state || raw.status || route.state || "active"),
    routeRaw: route.raw,
  };
}

async function repairMissingRoutes(limit: number) {
  const { data: wallets, error } = await supa
    .from("external_wallets")
    .select("id,user_id,chain,asset,address")
    .eq("status", "active")
    .or("bridge_payment_route_id.is.null,bridge_payment_route_id.eq.")
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit || 50, 100)));
  if (error) throw new Error(error.message);

  const results: Array<Record<string, unknown>> = [];
  for (const wallet of wallets || []) {
    const walletId = String((wallet as any).id || "");
    const userId = String((wallet as any).user_id || "");
    const chain = String((wallet as any).chain || "").toLowerCase();
    const asset = String((wallet as any).asset || "").toUpperCase();
    const address = String((wallet as any).address || "").trim();
    try {
      if (!SUPPORTED_CHAINS.has(chain) || !SUPPORTED_ASSETS.has(asset) || !validAddress(chain, address)) {
        results.push({ wallet_id: walletId, status: "skipped", reason: "unsupported_or_invalid_wallet" });
        continue;
      }
      const identity = await loadAndAssertBridgeIdentityInvariant(supa, userId);
      if (!identity.ok || !identity.context.bridge_customer_id) {
        results.push({ wallet_id: walletId, user_id: userId, status: "skipped", reason: identity.ok ? "missing_bridge_customer" : identity.failure.reason });
        continue;
      }
      const sourceBridgeWallet = await findCurrentBridgeWallet(userId, asset, chain);
      if (!sourceBridgeWallet) {
        results.push({ wallet_id: walletId, user_id: userId, status: "skipped", reason: "source_wallet_required" });
        continue;
      }
      const route = await createCryptoRoute({
        userId,
        bridgeCustomerId: identity.context.bridge_customer_id,
        asset,
        chain,
        address,
      });
      if (!route.routeId) {
        results.push({ wallet_id: walletId, user_id: userId, status: "error", reason: "route_id_missing" });
        continue;
      }
      const { error: updateError } = await supa
        .from("external_wallets")
        .update({
          bridge_payment_route_id: route.routeId,
          bridge_payment_route_status: route.routeStatus,
          bridge_payment_route_raw: route.routeRaw,
          bridge_payment_route_created_at: new Date().toISOString(),
          bridge_payment_route_error: null,
        })
        .eq("id", walletId);
      if (updateError) throw updateError;
      results.push({ wallet_id: walletId, user_id: userId, status: "repaired", bridge_payment_route_id: route.routeId });
    } catch (e) {
      const err = e as any;
      results.push({
        wallet_id: walletId,
        user_id: userId,
        status: "error",
        reason: String(err?.message || "route_repair_failed"),
        bridge_status: err?.status ?? null,
        bridge_code: err?.bridge_code ?? null,
        bridge_error: err?.bridge_error ?? null,
        bridge_request_id: err?.request_id ?? null,
        bridge_raw: err?.raw_text ?? null,
      });
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const action = String(body.action || "list");

  if (action === "repair_missing_routes") {
    const role = jwtRole(token);
    if (role !== "service_role") {
      return json({ success: false, error: "service role required", received_role: role || "missing" }, 401);
    }
    const results = await repairMissingRoutes(Number(body.limit || 50));
    return json({ success: true, data: { results } });
  }

  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  if (action === "list") {
    const { data } = await supa
      .from("external_wallets")
      .select("id, label, chain, asset, address, bridge_payment_route_id, bridge_payment_route_status, bridge_payment_route_raw, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    return json({ success: true, data: { wallets: data ?? [] } });
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

    const { data: existingWallet } = await supa
      .from("external_wallets")
      .select("id, label, chain, asset, address, status, bridge_payment_route_id, bridge_payment_route_status, bridge_payment_route_raw, created_at")
      .eq("user_id", user.id)
      .eq("chain", chain)
      .eq("address", address)
      .maybeSingle();

    if (existingWallet?.bridge_payment_route_id && routeStatusUsable(existingWallet.bridge_payment_route_status)) {
      const { data, error } = await supa
        .from("external_wallets")
        .update({
          label,
          asset,
          status: "active",
          bridge_payment_route_error: null,
        })
        .eq("id", existingWallet.id)
        .select("id, label, chain, asset, address, bridge_payment_route_id, bridge_payment_route_status, bridge_payment_route_raw, created_at")
        .maybeSingle();
      if (error) return json({ success: false, error: "Could not save that wallet. Please try again." }, 500);
      return json({ success: true, data: { wallet: data, reused_route: true } });
    }

    let routeId = "";
    let routeStatus = "";
    let routeRaw: unknown = null;
    if (!existingWallet?.bridge_payment_route_id || !routeStatusUsable(existingWallet.bridge_payment_route_status)) {
      try {
        const route = await createCryptoRoute({
          userId: user.id,
          bridgeCustomerId: profile.bridge_customer_id,
          asset,
          chain,
          address,
        });
        routeId = route.routeId;
        routeStatus = route.routeStatus;
        routeRaw = route.routeRaw;
      } catch (e) {
        console.error("external-wallet route creation failed", {
          user_id: user.id,
          asset,
          chain,
          error: (e as Error).message,
        });
        return json({
          success: false,
          code: "bridge_route_create_failed",
          error: "Could not register this withdrawal wallet with Bridge. Please try again or contact support.",
        }, 502);
      }
    }

    const { data, error } = await supa.from("external_wallets")
      .upsert({
        user_id: user.id,
        label,
        chain,
        asset,
        address,
        status: "active",
        bridge_payment_route_id: routeId,
        bridge_payment_route_status: routeStatus,
        bridge_payment_route_raw: routeRaw,
        bridge_payment_route_created_at: new Date().toISOString(),
        bridge_payment_route_error: null,
      },
              { onConflict: "user_id,chain,address" })
      .select("id, label, chain, asset, address, bridge_payment_route_id, bridge_payment_route_status, bridge_payment_route_raw, created_at")
      .maybeSingle();
    if (error) return json({ success: false, error: "Could not save that wallet. Please try again." }, 500);
    return json({ success: true, data: { wallet: data } });
  }

  return json({ success: false, error: "Unknown action" }, 400);
});
