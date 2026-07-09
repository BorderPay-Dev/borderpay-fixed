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
import { bridgeProvider, BridgeProviderError } from "../_shared/providers/bridge.ts";
import {
  loadVirtualAccountDeveloperFeePercent,
  loadVirtualAccountDestinationConfig,
  type VirtualAccountDestinationConfig,
  type VaCurrency,
} from "../_shared/providers/virtual-account-config.ts";

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
const ACTIVE_STATUSES = new Set(["active", "activated"]);
const DEACTIVATED_STATUSES = new Set(["inactive", "deactivated", "disabled", "closed", "archived", "cancelled", "canceled", "rejected", "suspended", "blocked"]);

function normalizeVaStatus(row: any): string {
  return String(row?.account_details?.status || row?.status || "").trim().toLowerCase();
}

function extractDepositInstructions(details: any): Record<string, unknown> {
  if (!details || typeof details !== "object") return {};
  if (details.source_deposit_instructions && typeof details.source_deposit_instructions === "object") {
    return details.source_deposit_instructions as Record<string, unknown>;
  }
  if (details.deposit_instructions && typeof details.deposit_instructions === "object") {
    return details.deposit_instructions as Record<string, unknown>;
  }
  return {};
}

async function loadCustomerUsdcBaseDestination(
  userId: string,
  bridgeCustomerId: string,
): Promise<VirtualAccountDestinationConfig | null> {
  const { data, error } = await supa
    .from("bridge_wallets")
    .select("bridge_wallet_id,currency,chain,status,updated_at")
    .or(`user_id.eq.${userId},business_user_id.eq.${userId}`)
    .eq("bridge_customer_id", bridgeCustomerId)
    .in("currency", ["USDC", "usdc"])
    .in("chain", ["base", "BASE"])
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn(`bridge-virtual-account: USDC/Base wallet lookup failed: ${error.message}`);
    return null;
  }
  const wallet = Array.isArray(data) ? data[0] : null;
  const bridgeWalletId = String(wallet?.bridge_wallet_id || "").trim();
  if (!bridgeWalletId) return null;
  return {
    currency: "USDC",
    payment_rail: "base",
    bridge_wallet_id: bridgeWalletId,
  };
}

async function loadVaDestination(
  userId: string,
  bridgeCustomerId: string,
  currency: VaCurrency,
): Promise<VirtualAccountDestinationConfig> {
  const customerWalletDestination = await loadCustomerUsdcBaseDestination(userId, bridgeCustomerId);
  if (customerWalletDestination) return customerWalletDestination;
  return await loadVirtualAccountDestinationConfig(supa, currency);
}

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

  // Existing-customer protection: one activated VA per currency. Deactivated
  // rows are provider-owned history and must not be shown/treated as active.
  const { data: existingRows } = await supa
    .from("bridge_virtual_accounts")
    .select("id, bridge_virtual_account_id, currency, status, rail, account_details")
    .or(`user_id.eq.${user.id},business_user_id.eq.${user.id}`)
    .eq("bridge_customer_id", profile.bridge_customer_id)
    .eq("currency", currency)
    .order("updated_at", { ascending: false })
    .limit(10);
  const existingVa = Array.isArray(existingRows)
    ? existingRows.find((row: any) => ACTIVE_STATUSES.has(normalizeVaStatus(row)) || ACTIVE_STATUSES.has(String(row?.status || "").toLowerCase()))
    : null;
  if (existingVa?.bridge_virtual_account_id) {
    const details = (existingVa.account_details && typeof existingVa.account_details === "object")
      ? (existingVa.account_details as Record<string, unknown>)
      : {};
    const dep = extractDepositInstructions(details);
    return json({
      success: true,
      code: "virtual_account_already_exists",
      summary: {
        code: "virtual_account_already_exists",
        currency,
        already_exists: true,
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
      },
    });
  }

  const deactivatedVa = Array.isArray(existingRows)
    ? existingRows.find((row: any) => DEACTIVATED_STATUSES.has(normalizeVaStatus(row)) || DEACTIVATED_STATUSES.has(String(row?.status || "").toLowerCase()))
    : null;
  if (deactivatedVa?.bridge_virtual_account_id) {
    return json({
      success: false,
      code: "virtual_account_deactivated",
      error: `${currency} account is deactivated. Contact support before using this rail.`,
      currency,
      summary: {
        code: "virtual_account_deactivated",
        currency,
        virtual_account_id: deactivatedVa.bridge_virtual_account_id,
      },
    }, 409);
  }

  try {
    const developerFeePercent = await loadVirtualAccountDeveloperFeePercent(supa);
    const destination = await loadVaDestination(user.id, profile.bridge_customer_id, currency as VaCurrency);
    const result = await bridgeProvider.createVirtualAccount({
      customer_id: profile.bridge_customer_id,
      currency: currency as VaCurrency,
      developer_fee_percent: developerFeePercent,
      destination,
      idempotency_key: `borderpay:va:${profile.bridge_customer_id}:${currency}`,
    });
    const raw = (result.raw as any)?.data ?? result.raw;
    const details = raw && typeof raw === "object" ? raw : {};
    const dep = extractDepositInstructions(details);
    const status = String((details as any)?.status || "activated").toLowerCase();

    await supa.from("bridge_virtual_accounts").upsert({
      user_id: isBusiness ? null : user.id,
      business_user_id: isBusiness ? user.id : null,
      bridge_customer_id: profile.bridge_customer_id,
      bridge_virtual_account_id: result.virtual_account_id,
      currency,
      rail: result.raw && typeof result.raw === "object"
        ? ((dep.payment_rail as string | undefined) ?? (Array.isArray(dep.payment_rails) ? String(dep.payment_rails[0] || "") : null))
        : null,
      status,
      developer_fee_percent: Number(developerFeePercent),
      account_details: details,
      updated_at: new Date().toISOString(),
    }, { onConflict: "bridge_virtual_account_id" });

    return json({
      success: true,
      code: "virtual_account_created",
      summary: {
        code: "virtual_account_created",
        currency,
        developer_fee_percent: developerFeePercent,
      },
      data: {
        virtual_account_id: result.virtual_account_id,
        account_number:     result.account_number ?? dep.bank_account_number ?? null,
        routing_number:     result.routing_number ?? dep.bank_routing_number ?? null,
        iban:               result.iban ?? dep.iban ?? null,
        bic:                result.bic ?? dep.bic ?? null,
        bank_name:          result.bank_name ?? dep.bank_name ?? null,
        currency,
        already_exists: false,
      },
    });
  } catch (e) {
    const providerError = e instanceof BridgeProviderError ? e : null;
    const providerStatus = providerError?.status ?? 502;
    return json({
      success: false,
      code: providerStatus >= 400 && providerStatus < 500 ? "bridge_virtual_account_rejected" : "bridge_virtual_account_failed",
      error: providerError?.bridge_error || providerError?.message || "Virtual account could not be created.",
      provider_status: providerStatus,
      provider_request_id: providerError?.request_id ?? null,
      bridge_code: providerError?.bridge_code ?? null,
      bridge_error: providerError?.bridge_error ?? null,
      summary: {
        code: providerStatus >= 400 && providerStatus < 500 ? "bridge_virtual_account_rejected" : "bridge_virtual_account_failed",
        currency,
      },
    }, providerStatus >= 400 && providerStatus < 500 ? 400 : 502);
  }

});
