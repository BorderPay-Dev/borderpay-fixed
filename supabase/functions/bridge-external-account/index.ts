// bridge-external-account — manage a customer's fiat payout (offramp) destinations.
//
// v1 supports Bridge external-account types documented in Orchestration:
//   • us   — USD bank account (account_number + routing_number). Usable for
//            ACH / ACH same-day / Wire payouts (rail chosen at transfer time).
//   • iban — EUR bank account (IBAN + BIC). SEPA.
//   • clabe — MXN SPEI account.
//   • pix  — BRL Pix key or BR code.
//
// Actions (single POST endpoint, switched on body.action):
//   • create  → POST   /v0/customers/{customerId}/external_accounts
//   • list    → GET    /v0/customers/{customerId}/external_accounts (passthrough;
//               the dashboard normally reads the local mirror via RLS instead)
//   • delete  → DELETE /v0/customers/{customerId}/external_accounts/{id}
//
// Guards (mirror bridge-virtual-account):
//   • verify_jwt = true; caller identified from the bearer token.
//   • Country gate via isBridgeBlocked.
//   • Requires bridge_customer_id + bridge_kyc_status='approved'.
//
// This function is SOURCE ONLY in this PR — not deployed. It requires the
// BRIDGE_API_KEY function secret (consumed by ../_shared/providers/
// bridge-client.ts) and the public.bridge_external_accounts table from
// 20260529_bridge_external_accounts.sql before it can run.
//
// Deploy (later, operator):
//   supabase functions deploy bridge-external-account --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";
import {
  isBridgeBlocked,
  bridgeCountryBlockResponse,
  logControlledBridgeTraffic,
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

interface UsAccountInput {
  account_type: "us";
  account_owner_name: string;
  account_owner_type?: "individual" | "business";
  account_name?: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  account_number: string;
  routing_number: string;
  checking_or_savings?: "checking" | "savings";
  bank_name?: string;
  address: { street_line_1: string; city: string; state?: string; postal_code: string; country: string };
}
interface IbanAccountInput {
  account_type: "iban";
  account_owner_name: string;
  account_name?: string;
  account_owner_type: "individual" | "business";
  iban_number: string;
  bic_swift: string;
  iban_country: string;
  bank_name?: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  address?: { street_line_1: string; city: string; postal_code: string; country: string; state?: string };
}
interface ClabeAccountInput {
  account_type: "clabe";
  account_owner_name: string;
  clabe_number: string;
  bank_name?: string;
  account_name?: string;
  account_owner_type?: "individual" | "business";
  first_name?: string;
  last_name?: string;
  business_name?: string;
  address: { street_line_1: string; city: string; state: string; postal_code: string; country: string };
}
interface PixAccountInput {
  account_type: "pix";
  account_owner_name: string;
  account_name?: string;
  bank_name?: string;
  pix_key?: string;
  br_code?: string;
  document_number: string;
}
type CreateInput = UsAccountInput | IbanAccountInput | ClabeAccountInput | PixAccountInput;

const last4 = (s: string) => (s || "").replace(/\s+/g, "").slice(-4);

function mapExternalAccountProviderError(
  status: number,
  providerMessage?: string,
  providerCode?: string,
  options?: { accountType?: "individual" | "business" | null },
): {
  status: number;
  code: string;
  error: string;
  provider_code?: string;
  expected_verification_status?: "approved";
} {
  const msg = String(providerMessage || "").toLowerCase();
  const code = String(providerCode || "").toLowerCase();
  const isBusiness = options?.accountType === "business";
  if (status === 429) {
    return { status: 429, code: "rate_limited", error: "Too many requests. Please retry shortly.", provider_code: code || undefined };
  }
  if (code === "requires_active_kyc_status" || msg.includes("requires_active_kyc_status")) {
    return {
      status: 409,
      code: "kyc_not_approved",
      error: isBusiness
        ? "Business verification is required before managing external accounts."
        : "Identity verification is required before managing external accounts.",
      provider_code: code || undefined,
      expected_verification_status: "approved",
    };
  }
  if (status === 400 || msg.includes("invalid") || msg.includes("missing")) {
    return {
      status: 400,
      code: "invalid_external_account_payload",
      error: "External account details are invalid. Please review and retry.",
      provider_code: code || undefined,
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 403,
      code: "external_account_not_allowed",
      error: "External account operation is not allowed for this profile yet.",
      provider_code: code || undefined,
    };
  }
  if (status === 404) {
    return { status: 404, code: "external_account_not_found", error: "External account was not found.", provider_code: code || undefined };
  }
  if (status >= 500 || status === 0) {
    return {
      status: 502,
      code: "provider_unavailable",
      error: "External account service is temporarily unavailable. Please retry.",
      provider_code: code || undefined,
    };
  }
  return {
    status: 502,
    code: "provider_error",
    error: "Unable to process external account request right now.",
    provider_code: code || undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({
      success: false,
      code: "method_not_allowed",
      error: "Invalid request method",
      expected_method: "POST",
    }, 405);
  }

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({
      success: false,
      code: "missing_bearer_token",
      error: "Authentication required",
    }, 401);
  }
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) {
    return json({
      success: false,
      code: "invalid_auth_token",
      error: "Unauthorized",
    }, 401);
  }

  let body: { action?: string; account?: CreateInput; external_account_id?: string };
  try { body = await req.json(); } catch {
    return json({
      success: false,
      code: "invalid_json_payload",
      error: "Invalid JSON payload",
    }, 400);
  }
  const action = String(body.action || "create");

  // Shared customer/KYC/country guard.
  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) return json({ success: false, ...identity.failure }, 409);
  const profile = identity.context;
  if (isBridgeBlocked(profile?.country)) {
    return json(bridgeCountryBlockResponse(profile!.country!), 403);
  }
  logControlledBridgeTraffic("bridge-external-account", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    return json({
      success: false,
      code: "no_customer",
      error: "Complete account setup before adding payout destinations",
      required_state: "bridge_customer_created",
    }, 409);
  }
  if (profile.verification_status !== "approved") {
    const verificationLabel = profile.account_type === "business" ? "KYB" : "KYC";
    return json({
      success: false,
      code: "kyc_not_approved",
      error: `${verificationLabel} not approved yet`,
      expected_verification_status: "approved",
    }, 409);
  }
  const customerId = profile.bridge_customer_id;

  // ── delete ────────────────────────────────────────────────────────────
  if (action === "delete") {
    const extId = String(body.external_account_id || "");
    if (!extId) {
      return json({
        success: false,
        code: "external_account_id_required",
        error: "external_account_id required",
      }, 400);
    }
    // Confirm ownership against the local mirror before touching Bridge.
    const { data: owned } = await supa
      .from("bridge_external_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("bridge_external_account_id", extId)
      .maybeSingle();
    if (!owned) {
      return json({
        success: false,
        code: "external_account_not_found",
        error: "External account was not found.",
      }, 404);
    }
    const r = await bridgeFetch({
      method: "DELETE",
      path:   `/v0/customers/${encodeURIComponent(customerId)}/external_accounts/${encodeURIComponent(extId)}`,
    });
    if (!r.ok) {
      const providerCode = String((r.data as any)?.code || (r.data as any)?.error_code || "").toLowerCase();
      const mapped = mapExternalAccountProviderError(r.status, r.error, providerCode, { accountType: profile.account_type });
      return json({
        success: false,
        code: mapped.code,
        error: mapped.error,
        ...(mapped.provider_code ? { provider_code: mapped.provider_code } : {}),
        ...(mapped.expected_verification_status
          ? { expected_verification_status: mapped.expected_verification_status }
          : {}),
        bridge_request_id: r.request_id ?? null,
      }, mapped.status);
    }
    await supa.from("bridge_external_accounts")
      .update({ active: false, status: "deleted", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("bridge_external_account_id", extId);
    return json({
      success: true,
      code: "external_account_deleted",
      summary: {
        code: "external_account_deleted",
        deleted: true,
      },
      data: { deleted: true, external_account_id: extId },
    });
  }

  // ── list (passthrough; dashboard normally reads the local mirror) ──────
  if (action === "list") {
    const r = await bridgeFetch({
      method: "GET",
      path:   `/v0/customers/${encodeURIComponent(customerId)}/external_accounts`,
    });
    if (!r.ok) {
      const providerCode = String((r.data as any)?.code || (r.data as any)?.error_code || "").toLowerCase();
      const mapped = mapExternalAccountProviderError(r.status, r.error, providerCode, { accountType: profile.account_type });
      return json({
        success: false,
        code: mapped.code,
        error: mapped.error,
        ...(mapped.provider_code ? { provider_code: mapped.provider_code } : {}),
        ...(mapped.expected_verification_status
          ? { expected_verification_status: mapped.expected_verification_status }
          : {}),
        bridge_request_id: r.request_id ?? null,
      }, mapped.status);
    }
    const listedAccounts = (r.data as any)?.data ?? r.data;
    const listedCount = Array.isArray(listedAccounts)
      ? listedAccounts.length
      : Array.isArray((listedAccounts as any)?.external_accounts)
      ? (listedAccounts as any).external_accounts.length
      : null;
    return json({
      success: true,
      code: "external_accounts_listed",
      ...(listedCount !== null
        ? {
            summary: {
              code: "external_accounts_listed",
              external_account_count: listedCount,
            },
          }
        : {}),
      data: listedCount !== null
        ? { ...(typeof listedAccounts === "object" && listedAccounts !== null ? listedAccounts : { items: listedAccounts }), external_account_count: listedCount }
        : listedAccounts,
    });
  }

  // ── capabilities (Bridge response only; no country heuristics) ─────────
  if (action === "capabilities") {
    const r = await bridgeFetch({
      method: "GET",
      path:   `/v0/customers/${encodeURIComponent(customerId)}/external_accounts`,
    });
    if (!r.ok) {
      const providerCode = String((r.data as any)?.code || (r.data as any)?.error_code || "").toLowerCase();
      const mapped = mapExternalAccountProviderError(r.status, r.error, providerCode, { accountType: profile.account_type });
      return json({
        success: false,
        code: mapped.code,
        error: mapped.error,
        ...(mapped.provider_code ? { provider_code: mapped.provider_code } : {}),
        ...(mapped.expected_verification_status
          ? { expected_verification_status: mapped.expected_verification_status }
          : {}),
        bridge_request_id: r.request_id ?? null,
      }, mapped.status);
    }
    const rows = ((r.data as any)?.data ?? r.data ?? []) as any[];
    const discovered = new Set<string>();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const t = String(row?.account_type || "").toLowerCase();
      if (t) discovered.add(t);
    }
    // If Bridge has no existing accounts yet, expose documented account types
    // so users can still start with first account creation.
    const supported_account_types =
      discovered.size > 0 ? Array.from(discovered) : ["us", "iban", "clabe", "pix"];
    return json({
      success: true,
      code: "external_account_supported_types_ready",
      summary: {
        code: "external_account_supported_types_ready",
        supported_type_count: supported_account_types.length,
      },
      data: { supported_account_types },
    });
  }

  // ── create ──────────────────────────────────────────────────────────
  // Paid gate: adding a payout destination is a money feature — requires an
  // activated (paid) plan. (list/delete stay open so users can always view /
  // remove existing destinations.)
  {
    const isBusiness = profile.account_type === "business";
    const __planGate = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!__planGate.allowed) return json(__planGate.body, __planGate.status);
  }
  const acct = body.account;
  if (!acct || (acct.account_type !== "us" && acct.account_type !== "iban" && acct.account_type !== "clabe" && acct.account_type !== "pix")) {
    return json({
      success: false,
      code: "invalid_account_type",
      error: "account.account_type must be 'us' | 'iban' | 'clabe' | 'pix'",
      supported_account_types: ["us", "iban", "clabe", "pix"],
    }, 400);
  }
  if (!acct.account_owner_name) {
    return json({
      success: false,
      code: "account_owner_name_required",
      error: "account_owner_name required",
    }, 400);
  }

  let bridgeBody: Record<string, unknown>;
  let currency: "USD" | "EUR" | "MXN" | "BRL";
  let railLabel: string;
  let derivedLast4: string;

  if (acct.account_type === "us") {
    const a = acct as UsAccountInput;
    if (!a.account_number || !a.routing_number) {
      return json({
        success: false,
        code: "us_account_number_routing_required",
        error: "account_number and routing_number required for US accounts",
      }, 400);
    }
    if (!a.address?.street_line_1 || !a.address?.city || !a.address?.postal_code || !a.address?.country) {
      return json({
        success: false,
        code: "us_full_address_required",
        error: "full address required for US accounts",
      }, 400);
    }
    currency = "USD";
    railLabel = "ach";
    derivedLast4 = last4(a.account_number);
    bridgeBody = {
      currency:           "usd",
      account_type:       "us",
      account_owner_name: a.account_owner_name,
      ...(a.account_owner_type ? { account_owner_type: a.account_owner_type } : {}),
      ...(a.account_name ? { account_name: a.account_name } : {}),
      ...(a.account_owner_type === "individual"
        ? {
            ...(a.first_name ? { first_name: a.first_name } : {}),
            ...(a.last_name ? { last_name: a.last_name } : {}),
          }
        : a.account_owner_type === "business"
        ? { ...(a.business_name ? { business_name: a.business_name } : {}) }
        : {}),
      ...(a.bank_name ? { bank_name: a.bank_name } : {}),
      account: {
        account_number: a.account_number,
        routing_number: a.routing_number,
        ...(a.checking_or_savings ? { checking_or_savings: a.checking_or_savings } : {}),
      },
      address: {
        street_line_1: a.address.street_line_1,
        city:          a.address.city,
        ...(a.address.state ? { state: a.address.state } : {}),
        postal_code:   a.address.postal_code,
        country:       a.address.country,
      },
    };
  } else if (acct.account_type === "iban") {
    const a = acct as IbanAccountInput;
    if (!a.iban_number || !a.bic_swift || !a.iban_country) {
      return json({
        success: false,
        code: "iban_fields_required",
        error: "iban_number, bic_swift, and iban_country required for IBAN accounts",
      }, 400);
    }
    if (a.account_owner_type !== "individual" && a.account_owner_type !== "business") {
      return json({
        success: false,
        code: "invalid_account_owner_type",
        error: "account_owner_type must be 'individual' or 'business'",
      }, 400);
    }
    if (a.account_owner_type === "individual" && (!a.first_name || !a.last_name)) {
      return json({
        success: false,
        code: "iban_individual_name_required",
        error: "first_name and last_name required for individual IBAN accounts",
      }, 400);
    }
    if (a.account_owner_type === "business" && !a.business_name) {
      return json({
        success: false,
        code: "iban_business_name_required",
        error: "business_name required for business IBAN accounts",
      }, 400);
    }
    currency = "EUR";
    railLabel = "sepa";
    derivedLast4 = last4(a.iban_number);
    bridgeBody = {
      currency:           "eur",
      account_type:       "iban",
      account_owner_name: a.account_owner_name,
      account_owner_type: a.account_owner_type,
      ...(a.account_name ? { account_name: a.account_name } : {}),
      ...(a.bank_name ? { bank_name: a.bank_name } : {}),
      ...(a.account_owner_type === "individual"
        ? { first_name: a.first_name, last_name: a.last_name }
        : { business_name: a.business_name }),
      iban: { account_number: a.iban_number, bic: a.bic_swift, country: a.iban_country },
      ...(a.address
        ? {
            address: {
              street_line_1: a.address.street_line_1,
              city: a.address.city,
              postal_code: a.address.postal_code,
              country: a.address.country,
              ...(a.address.state ? { state: a.address.state } : {}),
            },
          }
        : {}),
    };
  } else if (acct.account_type === "clabe") {
    const a = acct as ClabeAccountInput;
    if (!a.clabe_number) {
      return json({
        success: false,
        code: "clabe_number_required",
        error: "clabe_number required for CLABE accounts",
      }, 400);
    }
    if (!a.address?.street_line_1 || !a.address?.city || !a.address?.state || !a.address?.postal_code || !a.address?.country) {
      return json({
        success: false,
        code: "clabe_full_address_required",
        error: "full address required for CLABE accounts",
      }, 400);
    }
    currency = "MXN";
    railLabel = "spei";
    derivedLast4 = last4(a.clabe_number);
    bridgeBody = {
      currency:           "mxn",
      account_type:       "clabe",
      account_owner_name: a.account_owner_name,
      ...(a.bank_name ? { bank_name: a.bank_name } : {}),
      ...(a.account_name ? { account_name: a.account_name } : {}),
      ...(a.account_owner_type ? { account_owner_type: a.account_owner_type } : {}),
      ...(a.account_owner_type === "individual"
        ? { first_name: a.first_name, last_name: a.last_name }
        : a.account_owner_type === "business"
        ? { business_name: a.business_name }
        : {}),
      clabe: { account_number: a.clabe_number },
      address: {
        street_line_1: a.address.street_line_1,
        city:          a.address.city,
        state:         a.address.state,
        postal_code:   a.address.postal_code,
        country:       a.address.country,
      },
    };
  } else {
    const a = acct as PixAccountInput;
    const hasPixKey = !!a.pix_key?.trim();
    const hasBrCode = !!a.br_code?.trim();
    if (!hasPixKey && !hasBrCode) {
      return json({
        success: false,
        code: "pix_or_br_code_required",
        error: "pix_key or br_code required for Pix accounts",
      }, 400);
    }
    if (hasPixKey && hasBrCode) {
      return json({
        success: false,
        code: "pix_br_code_mutually_exclusive",
        error: "Provide only one of pix_key or br_code",
      }, 400);
    }
    if (!a.document_number?.trim()) {
      return json({
        success: false,
        code: "pix_document_number_required",
        error: "document_number required for Pix accounts",
      }, 400);
    }
    currency = "BRL";
    railLabel = "pix";
    derivedLast4 = last4(a.document_number);
    bridgeBody = {
      currency:           "brl",
      account_type:       "pix",
      account_owner_name: a.account_owner_name,
      ...(a.account_name ? { account_name: a.account_name } : {}),
      ...(a.bank_name ? { bank_name: a.bank_name } : {}),
      ...(hasPixKey
        ? { pix_key: { pix_key: a.pix_key, document_number: a.document_number } }
        : { br_code: { br_code: a.br_code, document_number: a.document_number } }),
    };
  }

  const r = await bridgeFetch({
    method:         "POST",
    path:           `/v0/customers/${encodeURIComponent(customerId)}/external_accounts`,
    body:           bridgeBody,
    idempotencyKey: `borderpay:extacct:${user.id}:${acct.account_type}:${derivedLast4}`,
  });
  if (!r.ok) {
    const providerCode = String((r.data as any)?.code || (r.data as any)?.error_code || "").toLowerCase();
    const mapped = mapExternalAccountProviderError(r.status, r.error, providerCode, { accountType: profile.account_type });
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      ...(mapped.provider_code ? { provider_code: mapped.provider_code } : {}),
      ...(mapped.expected_verification_status
        ? { expected_verification_status: mapped.expected_verification_status }
        : {}),
      bridge_request_id: r.request_id ?? null,
    }, mapped.status);
  }

  const data = (r.data as any)?.data ?? r.data;
  const extId = String(data?.id ?? "");
  if (!extId) {
    return json({
      success: false,
      code: "provider_external_account_id_missing",
      error: "Provider response missing external account id",
      summary: {
        code: "provider_external_account_id_missing",
      },
    }, 502);
  }

  // Mirror locally — descriptors only, never full account / routing / IBAN.
  const { error: upsertErr } = await supa.from("bridge_external_accounts").upsert({
    user_id:                    user.id,
    bridge_external_account_id: extId,
    bridge_customer_id:         customerId,
    account_type:               acct.account_type,
    currency,
    account_owner_name:         acct.account_owner_name,
    account_owner_type:         (acct as IbanAccountInput).account_owner_type ?? profile.account_type ?? null,
    bank_name:                  (acct as any).bank_name ?? data?.bank_name ?? null,
    last_4:                     data?.account?.last_4 ?? data?.iban?.last_4 ?? data?.clabe?.last_4 ?? data?.pix_key?.document_number_last4 ?? data?.br_code?.document_number_last4 ?? derivedLast4,
    rail:                       railLabel,
    status:                     "active",
    active:                     true,
    // Data minimization: store a sanitized boolean, NOT Bridge's raw
    // account_validation object. We never persist the vendor response
    // verbatim — only that validation was present.
    metadata:                   { validated: data?.account_validation != null },
    updated_at:                 new Date().toISOString(),
  }, { onConflict: "bridge_external_account_id" });
  if (upsertErr) {
    return json({
      success: false,
      code: "external_account_sync_failed",
      error: "External account was created but local sync failed. Please retry.",
      summary: {
        code: "external_account_sync_failed",
        external_account_id: extId,
      },
    }, 500);
  }

  return json({
    success: true,
    code: "external_account_created",
    summary: {
      code: "external_account_created",
      account_type: acct.account_type,
      currency,
      rail: railLabel,
    },
    data: {
      external_account_id: extId,
      account_type:        acct.account_type,
      currency,
      rail:                railLabel,
      last_4:              data?.account?.last_4 ?? data?.iban?.last_4 ?? data?.clabe?.last_4 ?? data?.pix_key?.document_number_last4 ?? data?.br_code?.document_number_last4 ?? derivedLast4,
      bank_name:           (acct as any).bank_name ?? data?.bank_name ?? null,
    },
  });
});
