// bridge-provision-stablecoins — ensure an activated, KYC-approved customer has
// their base stablecoin wallets (USDC on Base, USDT on Tron) so they can receive
// stablecoin AND so a virtual account has a settlement destination ready.
//
// Idempotent: creates a wallet only if that (currency, chain) is missing; if it
// already exists (incl. created on the Bridge dashboard once synced), it's a
// no-op. Safe to call on every dashboard load — ineligible users get a silent
// no-op for users who are not yet eligible.
//
// POST {} → { success, data: { wallets: [{symbol, chain, address, already}] } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { isBridgeBlocked, isBridgeCustodialWalletSupported } from "../_shared/providers/bridge-country-policy.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";

const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  let body: { user_id?: string; email?: string } = {};
  try { body = await req.json(); } catch { /* body optional for normal user path */ }

  if (timingSafeEqualStr(token, SERVICE_ROLE) && (body.user_id || body.email)) {
    return provisionForOperator(body);
  }

  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const noop = (reason: string) => json({ success: true, data: { wallets: [], skipped: reason } });

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
  if (!profile.bridge_customer_id) return noop("no_customer");
  const verification = profile.verification_status;
  if (verification !== "approved") return noop("kyc_not_approved");
  if (isBridgeBlocked(profile?.country) || !isBridgeCustodialWalletSupported(profile?.country)) return noop("country_unsupported");

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

  return json({ success: true, data: { wallets: out } });
});

async function provisionForOperator(body: { user_id?: string; email?: string }) {
  const userId = String(body.user_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (!userId && !email) return json({ success: false, error: "user_id or email required" }, 400);

  let query = supa
    .from("user_profiles")
    .select("id,email,account_type,bridge_customer_id,kyc_status,bridge_kyc_status,country")
    .limit(1);
  query = userId ? query.eq("id", userId) : query.ilike("email", email);
  const { data: rows, error } = await query;
  if (error) return json({ success: false, error: error.message }, 500);
  const profile = rows?.[0];
  if (!profile?.id) return json({ success: false, error: "User not found" }, 404);
  if (!profile.bridge_customer_id) return json({ success: false, code: "no_customer", error: "Bridge customer required first" }, 409);
  if (String(profile.bridge_kyc_status || "").toLowerCase() !== "approved" && String(profile.kyc_status || "").toLowerCase() !== "verified") {
    return json({ success: false, code: "kyc_not_approved", error: "KYC not approved yet" }, 409);
  }
  if (isBridgeBlocked(profile.country)) return json({ success: false, code: "country_blocked", country: profile.country }, 403);
  if (!isBridgeCustodialWalletSupported(profile.country)) {
    return json({
      success: false,
      code: "wallet_country_not_supported",
      error: "Bridge custodial wallets are not available for this country. Use a saved external wallet address as the virtual-account destination.",
      country: profile.country,
    }, 403);
  }

  const isBusiness = profile.account_type === "business";
  const ownerCols: Record<string, unknown> = { user_id: profile.id };
  if (isBusiness) ownerCols.business_user_id = profile.id;
  const out: Array<Record<string, unknown>> = [];

  for (const { symbol, chain } of DEFAULTS) {
    const { data: existing } = await supa
      .from("bridge_wallets")
      .select("bridge_wallet_id,address,currency,chain,status")
      .eq("bridge_customer_id", profile.bridge_customer_id)
      .ilike("currency", symbol)
      .ilike("chain", chain)
      .maybeSingle();
    if (existing?.bridge_wallet_id) {
      out.push({ ...existing, symbol, display_chain: chain.toLowerCase(), already: true });
      continue;
    }

    try {
      const created = await bridgeProvider.createWallet({ customer_id: profile.bridge_customer_id, symbol: symbol as any, chain: chain as any });
      const bridgeWalletRow = {
        ...ownerCols,
        bridge_customer_id: profile.bridge_customer_id,
        bridge_wallet_id: created.wallet_id,
        currency: symbol,
        chain: chain.toLowerCase(),
        address: created.deposit_address,
        status: "active",
        updated_at: new Date().toISOString(),
      };
      const { error: bwErr } = await supa.from("bridge_wallets").upsert(bridgeWalletRow as Record<string, unknown>, { onConflict: "bridge_wallet_id", ignoreDuplicates: false });
      const { error: wErr } = await supa.from("wallets").upsert({
        user_id: profile.id,
        currency: symbol,
        provider: "bridge",
        asset_type: "stablecoin",
        stablecoin_chain: chain.toLowerCase(),
        bridge_wallet_id: created.wallet_id,
        virtual_account_number: created.deposit_address,
        balance: 0,
        status: "active",
      });
      if (bwErr || wErr) {
        out.push({ symbol, chain: chain.toLowerCase(), created_at_bridge: true, persisted: false, bridge_wallet_id: created.wallet_id, error: (bwErr || wErr)?.message });
      } else {
        out.push({ symbol, chain: chain.toLowerCase(), created_at_bridge: true, persisted: true, bridge_wallet_id: created.wallet_id, address: created.deposit_address });
      }
    } catch (e) {
      out.push({ symbol, chain: chain.toLowerCase(), created_at_bridge: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    success: out.some((row) => row.persisted === true || row.already === true),
    user: { id: profile.id, email: profile.email, country: profile.country, bridge_customer_id: profile.bridge_customer_id },
    data: { wallets: out },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}
