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

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, account_type, country, bridge_customer_id, bridge_kyc_status")
    .eq("id", user.id)
    .maybeSingle();
  const isBusiness = profile?.account_type === "business";
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
  if (!profile?.bridge_customer_id) {
    return json({ success: false, error: "Bridge customer required first", code: "no_customer" }, 409);
  }
  if (verificationStatus !== "approved") {
    return json({ success: false, error: isBusiness ? "KYB not approved yet" : "KYC not approved yet", code: "kyc_not_approved" }, 409);
  }

  // Tier enforcement: the user's active subscription must allow this currency.
  //   • individual_starter / business_starter → USD only.
  //   • individual_premium / business_growth  → USD + EUR + GBP.
  //   • business_enterprise                    → USD + EUR + GBP.
  // We read the subscription owner row keyed on whether this is an
  // individual or business account.
  const subQuery = supa
    .from("user_subscriptions")
    .select("plan_key, status")
    .in("status", ["active", "trialing"])
    .maybeSingle();
  const { data: sub } = isBusiness
    ? await subQuery.eq("business_user_id", user.id)
    : await subQuery.eq("user_id", user.id);

  // Plan currency matrix (mirrors utils/subscriptions/plans.ts).
  // Kept in sync manually; if you change one, change the other.
  const PLAN_CURRENCIES: Record<string, ReadonlySet<string>> = {
    individual_starter:   new Set(["USD"]),
    individual_premium:   new Set(["USD", "EUR", "GBP"]),
    business_starter:     new Set(["USD"]),
    business_growth:      new Set(["USD", "EUR", "GBP"]),
    business_enterprise:  new Set(["USD", "EUR", "GBP"]),
  };
  const planKey = sub?.plan_key ?? (isBusiness ? "business_starter" : "individual_starter");
  const allowed = PLAN_CURRENCIES[planKey] ?? new Set(["USD"]);
  if (!allowed.has(currency)) {
    return json({
      success: false,
      code:    "plan_required",
      error:   `${currency} virtual accounts require a ${isBusiness ? "Growth or Enterprise" : "Premium"} plan. Your current plan: ${planKey.replace("_", " ")}.`,
      required_currency: currency,
      current_plan:      planKey,
      upgrade_to:        isBusiness ? "business_growth" : "individual_premium",
    }, 402);  // 402 Payment Required
  }

  // Idempotent: if a wallet for this currency already exists, return it.
  const { data: existing } = await supa
    .from("wallets")
    .select("id, bridge_virtual_account_id, virtual_account_number")
    .eq("user_id", user.id)
    .eq("currency", currency)
    .eq("provider", "bridge")
    .maybeSingle();
  if (existing?.bridge_virtual_account_id) {
    return json({ success: true, data: { virtual_account_id: existing.bridge_virtual_account_id, currency, already_exists: true } });
  }

  try {
    const result = await bridgeProvider.createVirtualAccount({
      customer_id: profile.bridge_customer_id,
      currency:    currency as "USD" | "EUR" | "GBP",
      ...(body.settle_into?.symbol && body.settle_into.chain ? {
        destination: {
          payment_rail: RAIL_BY_CCY[currency] as "ach"|"sepa"|"faster_payments",
          currency:     body.settle_into.symbol as any,
          chain:        body.settle_into.chain  as any,
          address:      body.settle_into.address,
        },
      } : {}),
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
    return json({ success: false, error: (e as Error).message }, 502);
  }
});
