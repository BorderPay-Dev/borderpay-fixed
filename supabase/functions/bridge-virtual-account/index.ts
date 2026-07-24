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
import { bridgeProvider, BridgeProviderError } from "../_shared/providers/bridge.ts";
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
  isBridgeVirtualAccountCurrencyAvailable,
} from "../_shared/providers/bridge-country-policy.ts";
import { requireMinimumWalletBalance } from "../_shared/funding-gate.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import {
  loadVirtualAccountDestinationConfig,
  loadVirtualAccountDeveloperFeePercent,
  type VaCurrency,
} from "../_shared/providers/virtual-account-config.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") || SUPABASE_SERVICE_ROLE_KEY;

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_CURRENCIES = new Set(["USD", "EUR", "GBP"]);
const RAIL_BY_CCY: Record<string, string> = { USD: "ach", EUR: "sepa", GBP: "faster_payments" };

function normalizeDeveloperFeePercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Number(n.toFixed(4));
}

async function deterministicIdempotencyKey(input: {
  customerId: string;
  currency: VaCurrency;
  destinationRail: string;
  destinationCurrency: string;
  destinationAddress: string;
  developerFeePercent: string;
}): Promise<string> {
  const digestInput = [
    input.customerId,
    input.currency,
    input.destinationRail.toLowerCase(),
    input.destinationCurrency.toLowerCase(),
    input.destinationAddress,
    input.developerFeePercent,
  ].join("|");
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digestInput));
  const hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
  return `borderpay:va:${input.customerId}:${input.currency.toLowerCase()}:${hash}`;
}

function opsAlertRecipients(): string[] {
  const raw = Deno.env.get("BORDERPAY_OPERATIONS_EMAILS") ||
    Deno.env.get("BORDERPAY_OPERATIONS_EMAIL") ||
    Deno.env.get("BORDERPAY_SUPPORT_EMAIL") ||
    "support@borderpayafrica.com";
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

async function notifyOpsIncident(input: {
  title: string;
  severity?: "high" | "critical";
  userId: string;
  accountType?: string | null;
  currency?: string | null;
  code: string;
  providerCode?: string | null;
  providerRequestId?: string | null;
  message?: string | null;
}) {
  if (!SUPABASE_URL || !SEND_EMAIL_TOKEN) return;
  const recipients = opsAlertRecipients();
  if (recipients.length === 0) return;
  const hour = new Date().toISOString().slice(0, 13);
  await Promise.allSettled(recipients.map(async (to) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template: "admin.incident_alert",
        to,
        idempotency_key: `ops:bridge-va:${input.userId}:${input.currency || "none"}:${input.code}:${hour}:${to}`,
        props: {
          severity: input.severity || "high",
          service: "bridge-virtual-account",
          title: input.title,
          user_id: input.userId,
          account_type: input.accountType || "unknown",
          currency: input.currency || "n/a",
          code: input.code,
          provider_code: input.providerCode || "",
          provider_request_id: input.providerRequestId || "",
          message: input.message || "",
          occurred_at: new Date().toISOString(),
        },
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(JSON.stringify({
        tag: "ops_incident_email_failed",
        status: res.status,
        to,
        code: input.code,
        body: text.slice(0, 300),
      }));
    }
  }));
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
      await notifyOpsIncident({
        title: "Global account capability check failed",
        userId: user.id,
        code: identity.failure.reason,
        message: identity.failure.error,
      });
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
    await notifyOpsIncident({
      title: "Global account activation blocked by identity state",
      severity: "critical",
      userId: user.id,
      currency,
      code: identity.failure.reason,
      message: identity.failure.error,
    });
    return json({
      success: false,
      code: "account_setup_pending",
      error: `${currency} account details are being prepared. We will notify you once they are ready.`,
      internal_code: identity.failure.reason,
      summary: {
        code: "account_setup_pending",
        currency,
      },
    }, 202);
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
  if (!profile.bridge_customer_id) {
    await notifyOpsIncident({
      title: "Approved user missing Bridge customer id",
      severity: "critical",
      userId: user.id,
      accountType: profile.account_type,
      currency,
      code: "approved_without_customer_id",
      message: "Approved entity reached virtual account creation without a Bridge customer id.",
    });
    return json({
      success: false,
      code: "account_setup_pending",
      error: `${currency} account details are being prepared. We will notify you once they are ready.`,
      required_state: "bridge_customer_created",
      summary: {
        code: "account_setup_pending",
        currency,
      },
    }, 202);
  }

  // Legacy minimum-balance gate retained as a compatibility no-op.
  {
    const __fund = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!__fund.allowed) return json(__fund.body, __fund.status);
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
      : {};
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

  let destination: Awaited<ReturnType<typeof loadVirtualAccountDestinationConfig>>;
  let developerFeePercent: string;
  let idempotencyKey: string;
  try {
    destination = await loadVirtualAccountDestinationConfig(supa, currency as VaCurrency);
    developerFeePercent = await loadVirtualAccountDeveloperFeePercent(supa);
    idempotencyKey = await deterministicIdempotencyKey({
      customerId: profile.bridge_customer_id,
      currency: currency as VaCurrency,
      destinationRail: destination.payment_rail,
      destinationCurrency: destination.currency,
      destinationAddress: destination.address,
      developerFeePercent: developerFeePercent,
    });
  } catch (e) {
    console.error(JSON.stringify({
      tag: "bridge_va_destination_config_missing",
      user_id: user.id,
      currency,
      error: e instanceof Error ? e.message : String(e),
    }));
    await notifyOpsIncident({
      title: "Global account destination config missing",
      severity: "critical",
      userId: user.id,
      accountType: profile.account_type,
      currency,
      code: "destination_config_pending",
      message: e instanceof Error ? e.message : String(e),
    });
    try {
      await supa.from("pending_va_requests").upsert({
        user_id:            user.id,
        bridge_customer_id: profile.bridge_customer_id,
        currency,
        status:             "pending",
        bridge_error:       "Virtual account destination configuration is pending.",
        bridge_error_code:  "destination_config_pending",
      }, { onConflict: "user_id,currency" });
    } catch { /* best-effort */ }
    return json({
      success: false,
      code: "virtual_account_setup_pending",
      error: `${currency} account setup is being enabled. We will notify you once it is ready.`,
      currency,
      summary: {
        code: "virtual_account_setup_pending",
        currency,
      },
    }, 202);
  }

  try {
    const result = await bridgeProvider.createVirtualAccount({
      customer_id: profile.bridge_customer_id,
      currency:    currency as "USD" | "EUR" | "GBP",
      developer_fee_percent: developerFeePercent,
      idempotency_key: idempotencyKey,
      destination: {
        payment_rail: destination.payment_rail,
        currency: destination.currency,
        address: destination.address,
      },
    });
    const raw = (result.raw && typeof result.raw === "object")
      ? (result.raw as Record<string, unknown>)
      : {};
    const srcDep = (raw.source_deposit_instructions && typeof raw.source_deposit_instructions === "object")
      ? (raw.source_deposit_instructions as Record<string, unknown>)
      : {};
    const persistedFee = normalizeDeveloperFeePercent((raw as Record<string, unknown>)?.developer_fee_percent) ??
      normalizeDeveloperFeePercent(developerFeePercent);
    if (persistedFee === null) {
      throw new Error(`Invalid developer fee resolved for ${currency}`);
    }

    // Write the table the dashboard reads (bridge_virtual_accounts), plus keep
    // the legacy wallets mirror for balance/ledger compatibility.
    await supa.from("bridge_virtual_accounts").insert({
      user_id:                   user.id,
      ...(isBusiness ? { business_user_id: user.id } : {}),
      bridge_customer_id:        profile.bridge_customer_id,
      bridge_virtual_account_id: result.virtual_account_id,
      currency,
      rail:                      String(srcDep.payment_rail || RAIL_BY_CCY[currency] || "").toLowerCase() || null,
      status:                    "active",
      developer_fee_percent:     persistedFee,
      account_details: {
        ...raw,
        source_currency: currency.toLowerCase(),
        destination,
        payment_rail: destination.payment_rail,
        developer_fee_percent: developerFeePercent,
        idempotency_key: idempotencyKey,
        provisioned_at: new Date().toISOString(),
        source_deposit_instructions: srcDep,
        deposit_instructions: srcDep,
        bridge_response: raw,
      },
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
      code: "virtual_account_created",
      summary: {
        code: "virtual_account_created",
        currency,
        already_exists: false,
      },
      data: {
        virtual_account_id: result.virtual_account_id,
        account_number:     result.account_number ?? srcDep.bank_account_number ?? null,
        routing_number:     result.routing_number ?? srcDep.bank_routing_number ?? null,
        iban:               result.iban ?? srcDep.iban ?? null,
        bic:                result.bic ?? srcDep.bic ?? null,
        bank_name:          result.bank_name ?? srcDep.bank_name ?? null,
        currency,
      },
    });
  } catch (e) {
    const err = e as Error;
    const msg = err.message || "";
    const providerCode = e instanceof BridgeProviderError ? String(e.bridge_code || "").toLowerCase() : "";
    const providerErrorText = e instanceof BridgeProviderError ? String(e.bridge_error || "") : "";
    const classifierText = `${msg} ${providerErrorText}`.toLowerCase();
    if (e instanceof BridgeProviderError) {
      console.error(JSON.stringify({
        tag: "bridge_va_provision_error",
        status: e.status ?? null,
        bridge_code: e.bridge_code ?? null,
        bridge_request_id: e.request_id ?? null,
        customer_id: profile.bridge_customer_id,
        idempotency_key: idempotencyKey,
        bridge_error: e.bridge_error ?? null,
      }));
      await notifyOpsIncident({
        title: "Bridge virtual account provider error",
        severity: e.status && e.status >= 500 ? "critical" : "high",
        userId: user.id,
        accountType: profile.account_type,
        currency,
        code: "bridge_provider_error",
        providerCode: e.bridge_code ?? null,
        providerRequestId: e.request_id ?? null,
        message: e.bridge_error ?? err.message,
      });
      const code = String(e.bridge_code || "").toLowerCase();
      if (code === "has_not_accepted_tos") {
        return json({
          success: false,
          code: "tos_required",
          error: "Please accept Terms of Service before creating an account.",
          provider_code: code || undefined,
          bridge_request_id: e.request_id || undefined,
          summary: {
            code: "tos_required",
          },
        }, 409);
      }
      if (code === "requires_active_kyc_status") {
        return json({
          success: false,
          code: "kyc_not_approved",
          error: isBusiness
            ? "Business verification is required before creating an account."
            : "Identity verification is required before creating an account.",
          expected_verification_status: "approved",
          provider_code: code || undefined,
          bridge_request_id: e.request_id || undefined,
          summary: {
            code: "kyc_not_approved",
          },
        }, 409);
      }
      if (code === "missing_required_endorsements" || code === "endorsement_requirements_not_met") {
        return json({
          success: false,
          code: "endorsement_required",
          error: "This virtual account currency is not enabled for your profile yet.",
          currency,
          provider_code: code || undefined,
          bridge_request_id: e.request_id || undefined,
          summary: {
            code: "endorsement_required",
            currency,
          },
        }, 403);
      }
    } else {
      console.error(JSON.stringify({
        tag: "bridge_va_provision_error",
        status: null,
        bridge_code: null,
        bridge_request_id: null,
        customer_id: profile.bridge_customer_id,
        idempotency_key: idempotencyKey,
        bridge_error: msg,
      }));
      await notifyOpsIncident({
        title: "Global account activation failed",
        severity: "critical",
        userId: user.id,
        accountType: profile.account_type,
        currency,
        code: "virtual_account_provision_failed",
        message: msg,
      });
    }
    // Bridge returns errors like "endorsement_not_granted" / "capability_not_granted"
    // when the customer hasn't been approved for SEPA / Faster Payments / etc. yet.
    // Queue the request for admin review instead of leaking a raw failure.
    const lower = classifierText;
    const isGrantPending =
      providerCode.includes("endorsement") ||
      providerCode.includes("capability") ||
      providerCode.includes("not_granted") ||
      providerCode.includes("not_eligible") ||
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
        error:   "Virtual account request is pending review. You will receive an email once approved.",
        currency,
        summary: {
          code: "va_grant_pending",
          currency,
        },
      }, 202);  // accepted, pending review
    }
    return json({
      success: false,
      code: "virtual_account_provision_failed",
      error: "Unable to create the account right now. Please try again shortly.",
      summary: {
        code: "virtual_account_provision_failed",
      },
    }, 502);
  }
});
