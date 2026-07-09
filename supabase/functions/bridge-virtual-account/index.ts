// bridge-virtual-account — create a USD/EUR/GBP virtual account (BorderPay policy scope).
//
// POST body:
//   { currency: 'USD'|'EUR'|'GBP' }
// or
//   { action: 'capabilities' } // returns allowed currencies for caller country
//
// Response: { success, data: { virtual_account_id, account_number, routing_number, iban, bic, bank_name, currency } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
  isBridgeVirtualAccountCurrencyAvailable,
} from "../_shared/providers/bridge-country-policy.ts";
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

  let body: { action?: string; currency?: string };
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
  const action = String(body.action || "create").toLowerCase();

  if (action === "capabilities") {
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
    const productCountry = profile.country;
    if (isBridgeBlocked(productCountry)) {
      return json(bridgeCountryBlockResponse(productCountry!), 403);
    }
    const supported_currencies = (["USD", "EUR", "GBP"] as const).filter((c) =>
      isBridgeVirtualAccountCurrencyAvailable(productCountry, c)
    );
    return json({
      success: true,
      code: "virtual_account_supported_currencies_ready",
      summary: {
        code: "virtual_account_supported_currencies_ready",
        supported_currency_count: supported_currencies.length,
      },
      data: { supported_currencies },
    });
  }

  const currency = String(body.currency || "").toUpperCase();
  if (!ALLOWED_CURRENCIES.has(currency)) {
    return json({
      success: false,
      code: "invalid_currency",
      error: "Unsupported virtual account currency.",
      supported_currencies: Array.from(ALLOWED_CURRENCIES),
      summary: {
        code: "invalid_currency",
        currency: currency || null,
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
  const productCountry = profile.country;
  const verificationStatus = profile.verification_status;

  if (isBridgeBlocked(productCountry)) {
    return json(bridgeCountryBlockResponse(productCountry!), 403);
  }
  if (!isBridgeVirtualAccountCurrencyAvailable(productCountry, currency)) {
    return json({
      success: false,
      code: "country_rail_not_supported",
      error: "This virtual account currency is not available for your country.",
      country: productCountry,
      currency,
      summary: {
        code: "country_rail_not_supported",
        country: productCountry || null,
        currency,
      },
    }, 403);
  }
  logControlledBridgeTraffic("bridge-virtual-account", productCountry, user.id);
  if (!profile.bridge_customer_id) {
    return json({
      success: false,
      code: "no_customer",
      error: "Complete account setup before creating a virtual account",
      required_state: "bridge_customer_created",
      summary: {
        code: "no_customer",
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
      },
    }, 409);
  }

  // Existing-customer protection: one active VA per currency.
  const { data: existingVa } = await supa
    .from("bridge_virtual_accounts")
    .select("id, bridge_virtual_account_id, currency, status, rail, account_details")
    .or(`user_id.eq.${user.id},business_user_id.eq.${user.id}`)
    .eq("bridge_customer_id", profile.bridge_customer_id)
    .eq("currency", currency)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingVa?.bridge_virtual_account_id) {
    const details = (existingVa.account_details && typeof existingVa.account_details === "object")
      ? (existingVa.account_details as Record<string, unknown>)
      : {};
    const dep = (details.deposit_instructions && typeof details.deposit_instructions === "object")
      ? details.deposit_instructions as Record<string, unknown>
      : (details.source_deposit_instructions && typeof details.source_deposit_instructions === "object")
      ? details.source_deposit_instructions as Record<string, unknown>
      : {};
    const requestedAt = String(details.borderpay_user_requested_at || new Date().toISOString());
    const nextDetails = {
      ...details,
      borderpay_user_requested: true,
      borderpay_user_requested_at: requestedAt,
    };
    await supa
      .from("bridge_virtual_accounts")
      .update({
        account_details: nextDetails,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingVa.id);
    return json({
      success: true,
      code: "virtual_account_activated",
      summary: {
        code: "virtual_account_activated",
        currency,
        already_exists: true,
        user_requested: true,
      },
      data: {
        virtual_account_id: existingVa.bridge_virtual_account_id,
        account_number:     dep.bank_account_number ?? null,
        routing_number:     dep.bank_routing_number ?? null,
        iban:               dep.iban ?? null,
        bic:                dep.bic ?? null,
        bank_name:          dep.bank_name ?? null,
        currency,
        already_exists: true,
        user_requested: true,
        requested_at: requestedAt,
      },
    });
  }

  return json({
    success: false,
    code: "virtual_account_not_granted",
    error: `${currency} account is not available on your Bridge profile yet. Contact support if you need this rail.`,
    currency,
    summary: {
      code: "virtual_account_not_granted",
      currency,
    },
  }, 409);

});
