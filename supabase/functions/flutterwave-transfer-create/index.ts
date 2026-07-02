import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveCreateTransfer,
  flutterwaveRetryTransfer,
} from "../_shared/providers/flutterwave.ts";
import { mapFlutterwaveErrorResponse } from "../_shared/providers/flutterwave-error-response.ts";
import {
  ensureBusinessProfileForAccountType,
  gateFlutterwaveRuntime,
  getRuntimeCapsAndPolicy,
  parseAccountType,
  validateCountryOnPolicy,
  validateCurrencyOnPolicy,
} from "../_shared/services/flutterwave-runtime.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function toPositiveNumber(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3,5}$/.test(value);
}

function isSafeReference(value: string): boolean {
  return /^[A-Za-z0-9._:-]{6,120}$/.test(value);
}

function isSafeBankCode(value: string): boolean {
  return /^[A-Za-z0-9_-]{2,20}$/.test(value);
}

function isSafeAccountNumber(value: string): boolean {
  return /^[0-9]{6,34}$/.test(value);
}

function isSafeProviderId(value: string): boolean {
  return /^[A-Za-z0-9_-]{2,120}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const runtimeGate = gateFlutterwaveRuntime("payout");
  const caps = runtimeGate.caps;
  const staticIpGuard = runtimeGate.staticIpGuard;
  const { localRailPolicy } = getRuntimeCapsAndPolicy();
  if (!runtimeGate.allowed) return json(runtimeGate.body, runtimeGate.status);
  if (staticIpGuard.blocked) {
    return json({
      success: false,
      code: "flutterwave_static_ip_not_ready",
      error: "Local payout rails are temporarily unavailable. Please try again later.",
      data: {
        capabilities: caps,
        static_ip_guard: staticIpGuard,
      },
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !authData?.user?.id) return json({ success: false, error: "Unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const accountType = parseAccountType(body?.account_type);
  if (!accountType) {
    return json({ success: false, code: "invalid_account_type", error: "account_type must be individual or business." }, 400);
  }

  const mode = String(body?.mode || "create").trim().toLowerCase();
  if (!["create", "retry"].includes(mode)) {
    return json({ success: false, code: "invalid_mode", error: "mode must be create or retry" }, 400);
  }
  if (mode === "retry") {
    const transferId = String(body?.transfer_id || "").trim();
    if (!transferId) return json({ success: false, error: "transfer_id is required for retry mode" }, 400);
    if (!isSafeProviderId(transferId)) {
      return json({ success: false, error: "transfer_id format is invalid" }, 400);
    }

    const { data: ownerProbe } = await supa
      .from("flutterwave_transfers")
      .select("user_id,business_user_id")
      .eq("flutterwave_transfer_id", transferId)
      .maybeSingle();
    if (!ownerProbe) {
      return json({ success: false, code: "transfer_not_found", error: "Transfer not found for current account." }, 404);
    }
    const knownOwners = [ownerProbe.user_id, ownerProbe.business_user_id].filter(Boolean);
    if (knownOwners.length === 0) {
      return json({ success: false, code: "owner_not_assigned", error: "Transfer owner is not assigned yet." }, 409);
    }
    if (knownOwners.length > 0 && !knownOwners.includes(authData.user.id)) {
      return json({ success: false, error: "Transfer does not belong to current user" }, 403);
    }
    if (ownerProbe.business_user_id === authData.user.id) {
      const hasBusinessProfile = await ensureBusinessProfileForAccountType(supa, authData.user.id, "business");
      if (!hasBusinessProfile) {
        return json({ success: false, code: "business_profile_required", error: "Business profile is required for business transfer retries." }, 403);
      }
    }

    const resolvedAccountType = ownerProbe.business_user_id === authData.user.id ? "business" : "individual";
    const res = await flutterwaveRetryTransfer(transferId, body?.retry_payload || {});
    if (!res.ok) {
      const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to retry transfer");
      return json({
        success: false,
        code: mapped.code,
        error: mapped.error,
        data: { capabilities: caps },
      }, mapped.status);
    }
    return json({
      success: true,
      data: {
        mode: "retry",
        capabilities: caps,
        account_context: {
          requested_account_type: accountType,
          resolved_account_type: resolvedAccountType,
        },
        transfer: res.data,
      },
    });
  }

  const amount = toPositiveNumber(body?.amount);
  const currency = String(body?.currency || "").trim().toUpperCase();
  const country = String(body?.country || "").trim().toUpperCase();
  const accountBank = String(body?.account_bank || "").trim();
  const accountNumber = String(body?.account_number || "").trim();
  const reference = String(body?.reference || "").trim();

  if (!amount) return json({ success: false, error: "amount must be > 0" }, 400);
  if (!currency) return json({ success: false, error: "currency is required" }, 400);
  if (!isCurrencyCode(currency)) return json({ success: false, error: "currency format is invalid" }, 400);
  const currencies = localRailPolicy.currencies as readonly string[];
  const countries = localRailPolicy.countries as readonly string[];
  const currencyCheck = validateCurrencyOnPolicy(currency, currencies);
  if (!currencyCheck.allowed) return json(currencyCheck.body, currencyCheck.status);
  const countryCheck = validateCountryOnPolicy(country, countries);
  if (!countryCheck.allowed) return json(countryCheck.body, countryCheck.status);
  if (!accountBank) return json({ success: false, error: "account_bank is required" }, 400);
  if (!isSafeBankCode(accountBank)) return json({ success: false, error: "account_bank format is invalid" }, 400);
  if (!accountNumber) return json({ success: false, error: "account_number is required" }, 400);
  if (!isSafeAccountNumber(accountNumber)) return json({ success: false, error: "account_number format is invalid" }, 400);
  if (!reference) return json({ success: false, error: "reference is required" }, 400);
  if (!isSafeReference(reference)) {
    return json({ success: false, error: "reference format is invalid" }, 400);
  }
  if (accountType === "business") {
    const hasBusinessProfile = await ensureBusinessProfileForAccountType(supa, authData.user.id, accountType);
    if (!hasBusinessProfile) {
      return json({ success: false, code: "business_profile_required", error: "Business profile is required for business transfers." }, 403);
    }
  }

  const { data: existingReference } = await supa
    .from("flutterwave_transfers")
    .select("reference,user_id,business_user_id")
    .eq("reference", reference)
    .maybeSingle();
  if (existingReference) {
    const knownOwners = [existingReference.user_id, existingReference.business_user_id].filter(Boolean);
    if (knownOwners.length > 0 && !knownOwners.includes(authData.user.id)) {
      return json({ success: false, code: "reference_conflict", error: "reference is already used by another account" }, 409);
    }
  }

  const debitCurrency = body?.debit_currency ? String(body.debit_currency).toUpperCase() : undefined;
  if (debitCurrency && !isCurrencyCode(debitCurrency)) {
    return json({ success: false, error: "debit_currency format is invalid" }, 400);
  }

  const res = await flutterwaveCreateTransfer({
    amount,
    currency,
    account_bank: accountBank,
    account_number: accountNumber,
    reference,
    narration: body?.narration ? String(body.narration) : undefined,
    callback_url: body?.callback_url ? String(body.callback_url) : undefined,
    debit_currency: debitCurrency,
    beneficiary_name: body?.beneficiary_name ? String(body.beneficiary_name) : undefined,
    ...(() => {
      const inputMeta = typeof body?.meta === "object" && body?.meta !== null ? body.meta : {};
      return {
        meta: {
          ...inputMeta,
          borderpay_user_id: authData.user.id,
          borderpay_account_type: accountType,
          borderpay_transfer_reference: reference,
          ...(country ? { borderpay_country: country } : {}),
        },
      };
    })(),
  });

  if (!res.ok) {
    const mapped = mapFlutterwaveErrorResponse(res.error, res.error || "Failed to create transfer");
    return json({
      success: false,
      code: mapped.code,
      error: mapped.error,
      data: { capabilities: caps },
    }, mapped.status);
  }

  const businessUserId = accountType === "business" ? authData.user.id : null;
  await supa.from("flutterwave_transfers").upsert({
    reference,
    flutterwave_transfer_id: String((res.data as any)?.id || (res.data as any)?.data?.id || ""),
    user_id: accountType === "business" ? null : authData.user.id,
    business_user_id: businessUserId,
    amount,
    currency,
    metadata: {
      account_type: accountType,
      initiated_by: authData.user.id,
      source: "flutterwave",
      provider_request_id: res.requestId || null,
    },
    last_provider_status_at: new Date().toISOString(),
    raw_payload: res.data ?? {},
  }, { onConflict: "reference" });

  return json({
    success: true,
    data: {
      mode: "create",
      capabilities: caps,
      account_context: {
        requested_account_type: accountType,
        resolved_account_type: accountType,
      },
      provider_request_id: res.requestId || null,
      transfer: res.data,
    },
  });
});
