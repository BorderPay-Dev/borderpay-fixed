// bridge-virtual-account — create a USD/EUR/GBP virtual account.
//
// POST body: { currency: 'USD'|'EUR'|'GBP', settle_into?: { symbol, chain, address } }
//
// Response: { success, data: { virtual_account_id, account_number, routing_number, iban, bic, bank_name, currency } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
  isBridgeVirtualAccountCurrencyAvailable,
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

const ALLOWED_CURRENCIES = new Set(["USD", "EUR", "GBP"]);
const RAIL_BY_CCY: Record<string, string> = { USD: "ach", EUR: "sepa", GBP: "faster_payments" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: { currency?: string; settle_into?: { symbol?: string; chain?: string; address?: string } };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const currency = String(body.currency || "").toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    return json({ success: false, error: `currency must be USD, EUR, or GBP (got ${currency})` }, 400);
  }

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    return json({ success: false, ...identity.failure }, 409);
  }
  const profile = identity.context;
  const isBusiness = profile.account_type === "business";
  const productCountry = profile.country;
  const verificationStatus = profile.verification_status;

  if (isBridgeBlocked(productCountry)) {
    return json(bridgeCountryBlockResponse(productCountry!), 403);
  }
  if (!isBridgeVirtualAccountCurrencyAvailable(productCountry, currency)) {
    return json({
      success: false,
      code: "country_rail_not_supported",
      error: `${currency} virtual accounts are not available for your country through BorderPay.`,
      country: productCountry,
      currency,
    }, 403);
  }
  logControlledBridgeTraffic("bridge-virtual-account", productCountry, user.id);
  if (!profile.bridge_customer_id) {
    return json({ success: false, error: "Bridge customer required first", code: "no_customer" }, 409);
  }
  if (verificationStatus !== "approved") {
    return json({ success: false, error: isBusiness ? "KYB not approved yet" : "KYC not approved yet", code: "kyc_not_approved" }, 409);
  }

  // Funding gate: replace the prior activation-fee model with a minimum
  // wallet-balance requirement. The user must hold at least $20 USD-equivalent
  // across their BorderPay wallets — funds are NOT deducted, they stay theirs.
  {
    const __fund = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!__fund.allowed) return json(__fund.body, __fund.status);
  }

  // Idempotent: if this VA already exists in the UI mirror, return it.
  const { data: existingVa } = await supa
    .from("bridge_virtual_accounts")
    .select("id, bridge_virtual_account_id")
    .eq("user_id", user.id)
    .eq("currency", currency)
    .maybeSingle();
  if (existingVa?.bridge_virtual_account_id) {
    return json({ success: true, data: { virtual_account_id: existingVa.bridge_virtual_account_id, currency, already_exists: true } });
  }

  // Bridge REQUIRES a destination stablecoin wallet (incoming fiat auto-converts
  // to it) AND the (stablecoin, chain) pair must be valid for the SOURCE fiat.
  // Empirically confirmed against Bridge: EUR/GBP settle to USDC on EVM/Solana
  // rails (e.g. Base) but NOT to USDT and NOT on Tron; USD is permissive. So we
  // resolve a *compatible* wallet — and if the user doesn't have one, we
  // provision USDC-on-Base automatically rather than failing the request.
  //
  // EUR/GBP-safe settlement: USDC only, on a non-Tron rail.
  const EUR_SAFE_CHAINS = ["base", "ethereum", "polygon", "solana", "arbitrum", "optimism"];
  const needsEurSafe = currency === "EUR" || currency === "GBP";

  const { data: stableWallets } = await supa
    .from("bridge_wallets")
    .select("currency, chain, address")
    .eq("user_id", user.id)
    .not("address", "is", null);
  const lc = (s: any) => String(s ?? "").toLowerCase();
  const isUsdc = (w: any) => lc(w.currency) === "usdc";
  const isUsdt = (w: any) => lc(w.currency) === "usdt";
  const eurSafe = (w: any) => isUsdc(w) && EUR_SAFE_CHAINS.includes(lc(w.chain));

  let pick = needsEurSafe
    ? (stableWallets || []).find(eurSafe)
    : ((stableWallets || []).find(isUsdc) ?? (stableWallets || []).find(isUsdt) ?? (stableWallets || [])[0]);

  // No compatible wallet → provision USDC on Base (works for USD, EUR and GBP),
  // persist it, and use it as the destination. (Provisioning a receive address
  // is not money movement.)
  if (!pick?.address || !pick?.chain) {
    try {
      const created = await bridgeProvider.createWallet({
        customer_id: profile.bridge_customer_id,
        symbol: "USDC" as any,
        chain:  "BASE" as any,
      });
      await supa.from("bridge_wallets").insert({
        user_id:            user.id,
        ...(isBusiness ? { business_user_id: user.id } : {}),
        bridge_customer_id: profile.bridge_customer_id,
        bridge_wallet_id:   created.wallet_id,
        currency:           "USDC",
        chain:              "base",
        address:            created.deposit_address,
        status:             "active",
      });
      pick = { currency: "USDC", chain: "base", address: created.deposit_address };
    } catch (e) {
      return json({
        success: false,
        code:    "settlement_wallet_failed",
        error:   `Could not prepare a settlement wallet for your ${currency} account. Please try again.`,
        detail:  (e as Error).message,
      }, 502);
    }
  }

  try {
    const result = await bridgeProvider.createVirtualAccount({
      customer_id: profile.bridge_customer_id,
      currency:    currency as "USD" | "EUR" | "GBP",
      destination: {
        rail:     String(pick.chain),
        currency: String(pick.currency).toLowerCase(),
        address:  String(pick.address),
      },
    });

    // Write the table the dashboard reads (bridge_virtual_accounts), plus keep
    // the legacy wallets mirror for balance/ledger compatibility.
    await supa.from("bridge_virtual_accounts").insert({
      user_id:                   user.id,
      ...(isBusiness ? { business_user_id: user.id } : {}),
      bridge_customer_id:        profile.bridge_customer_id,
      bridge_virtual_account_id: result.virtual_account_id,
      currency,
      rail:                      RAIL_BY_CCY[currency] ?? null,
      status:                    "active",
      account_details:           result.raw ?? null,
    });
    await supa.from("wallets").upsert({
      user_id:                   user.id,
      currency,
      balance:                   0,
      provider:                  "bridge",
      asset_type:                "fiat_virtual_account",
      bridge_virtual_account_id: result.virtual_account_id,
      virtual_account_number:    result.account_number || result.iban || null,
      status:                    "active",
    }, { onConflict: "user_id,currency", ignoreDuplicates: false });

    return json({
      success: true,
      data: {
        virtual_account_id: result.virtual_account_id,
        account_number:     result.account_number,
        routing_number:     result.routing_number,
        iban:               result.iban,
        bic:                result.bic,
        bank_name:          result.bank_name,
        currency,
      },
    });
  } catch (e) {
    const msg = (e as Error).message || "";
    // Bridge returns errors like "endorsement_not_granted" / "capability_not_granted"
    // when the customer hasn't been approved for SEPA / Faster Payments / etc. yet.
    // Queue the request for admin review instead of leaking a raw failure.
    const lower = msg.toLowerCase();
    const isGrantPending =
      lower.includes("endorsement") ||
      lower.includes("not granted") ||
      lower.includes("not_granted") ||
      lower.includes("capability") ||
      lower.includes("not eligible") ||
      lower.includes("not_eligible");
    if (isGrantPending) {
      try {
        await supa.from("pending_va_requests").upsert({
          user_id:            user.id,
          bridge_customer_id: profile.bridge_customer_id,
          currency,
          status:             "pending",
          bridge_error:       msg.slice(0, 500),
          bridge_error_code:  "endorsement_not_granted",
        }, { onConflict: "user_id,currency" });
      } catch { /* best-effort */ }
      return json({
        success: false,
        code:    "va_grant_pending",
        error:   `${currency} accounts are not enabled for your profile yet. Your request was sent for review — you’ll get an email once it’s approved (usually a few business days).`,
        currency,
      }, 202);  // accepted, pending review
    }
    return json({ success: false, error: msg }, 502);
  }
});
