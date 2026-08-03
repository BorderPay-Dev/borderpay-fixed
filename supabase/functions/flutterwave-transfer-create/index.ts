import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveCreateTransfer,
  mapFlutterwaveProviderStatus,
  flutterwaveRetryTransfer,
  getFlutterwaveCapabilities,
  getFlutterwaveNetworkGuard,
} from "../_shared/providers/flutterwave.ts";
import { userSafeFlutterwavePayoutError } from "../_shared/providers/flutterwave-v4-payout.ts";
import {
  evaluateProviderCorridorPolicy,
  isBridgeProfileVerified,
} from "../_shared/providers/provider-corridor-policy.ts";
import {
  authenticateAfricanRailsTester,
  recordAfricanRailsOperatorAlert,
} from "../_shared/african-rails-access.ts";

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

function validReference(value: string): boolean {
  const v = String(value || "").trim();
  // Flutterwave V4 reference schema: alphanumeric/hyphen, 6-42 chars.
  return /^[A-Za-z0-9-]{6,42}$/.test(v);
}

function validRecipientName(value: string): boolean {
  return /^(?![ ,.'-]*$)[A-Za-z ,.'-]{2,50}$/.test(value);
}

function transferData(input: any): any {
  return input?.data && typeof input.data === "object" ? input.data : input;
}

function v4TransferData(input: any): any {
  const envelope = transferData(input);
  return envelope?.transfer?.data ?? envelope?.transfer ?? envelope;
}

function maskAccountNumber(v: string): string {
  const trimmed = String(v || "").trim();
  if (trimmed.length <= 4) return trimmed;
  return `${"*".repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const access = await authenticateAfricanRailsTester(supa, req);
  if (!access.allowed) {
    return json({ success: false, code: access.code, error: access.message }, access.status);
  }
  const authData = { user: access.user };

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.payout_enabled) {
    await recordAfricanRailsOperatorAlert(supa, {
      userId: access.user.id,
      endpoint: "flutterwave-transfer-create",
      code: !caps.configured ? "flutterwave_not_configured" : "flutterwave_payout_disabled",
      message: "Controlled Flutterwave payout test is blocked by runtime configuration.",
    });
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "This payout route is temporarily unavailable.",
      data: { capabilities: caps },
    }, 503);
  }

  const networkGuard = getFlutterwaveNetworkGuard("money_movement");
  if (!networkGuard.allowed) {
    return json({
      success: false,
      code: networkGuard.code,
      error: "This payout route is temporarily unavailable while connectivity is being verified.",
      data: { capabilities: caps, network_guard: networkGuard },
    }, 503);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const source = String(body?.source || "").trim().toLowerCase();
  if (source && source !== "flutterwave") {
    return json({ success: false, error: "source must be flutterwave" }, 400);
  }

  const mode = String(body?.mode || "create").trim().toLowerCase();
  if (mode === "retry") {
    const transferId = String(body?.transfer_id || "").trim();
    const reference = String(body?.reference || "").trim();
    if (!transferId && !reference) {
      return json({ success: false, error: "transfer_id or reference is required for retry mode" }, 400);
    }
    let providerTransferId = transferId;
    let localStatus: string | null = null;
    if (!providerTransferId && reference) {
      const { data: existing } = await supa
        .from("flutterwave_transfers")
        .select("id, provider_transfer_id, reference, status")
        .eq("reference", reference)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      providerTransferId = String(existing?.provider_transfer_id || "").trim();
      localStatus = String(existing?.status || "").trim().toLowerCase() || null;
      if (!providerTransferId) {
        return json({ success: false, error: "No provider transfer found for this reference yet." }, 404);
      }
    } else if (providerTransferId) {
      const { data: existingByProvider } = await supa
        .from("flutterwave_transfers")
        .select("id, status")
        .eq("provider_transfer_id", providerTransferId)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      localStatus = String(existingByProvider?.status || "").trim().toLowerCase() || null;
    }

    if (localStatus === "completed" || localStatus === "reversed") {
      return json({
        success: false,
        code: "retry_not_allowed_terminal_state",
        error: `Retry is not allowed when transfer status is ${localStatus}.`,
      }, 409);
    }

    const res = await flutterwaveRetryTransfer(providerTransferId, {
      ...(typeof body?.retry_payload === "object" && body.retry_payload ? body.retry_payload : {}),
      reference: reference || String(body?.retry_reference || "").trim(),
    });
    if (!res.ok) {
      const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
      const isInactive = res.error === "flutterwave_account_inactive" || res.error === "flutterwave_auth_error";
      await supa
        .from("flutterwave_transfers")
        .update({
          status: "failed",
          provider_response: res.data ?? {},
          provider_request_id: res.traceId || null,
          provider_http_status: Number.isFinite(res.status) ? res.status : null,
          last_error: res.error || "retry_failed",
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("provider_transfer_id", providerTransferId)
        .eq("user_id", authData.user.id);
      return json({
        success: false,
        code: isIpGuard
          ? "static_ip_not_ready"
          : (isInactive ? "provider_inactive" : "upstream_error"),
        error: isIpGuard
          ? "This payout route is temporarily unavailable while connectivity is being verified."
          : (isInactive
            ? "This payout route is temporarily unavailable. No funds were sent."
            : userSafeFlutterwavePayoutError(res.error)),
        data: { capabilities: caps },
      }, (isIpGuard || isInactive) ? 503 : 502);
    }

    const rData = transferData(res.data);
    const providerStatus = String(rData?.status || "");
    const mappedStatus = mapFlutterwaveProviderStatus(providerStatus);
    await supa
      .from("flutterwave_transfers")
      .update({
        status: mappedStatus,
        provider_status: providerStatus || null,
        provider_response: res.data ?? {},
        provider_request_id: res.traceId || null,
        provider_http_status: Number.isFinite(res.status) ? res.status : null,
        last_error: null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("provider_transfer_id", providerTransferId)
      .eq("user_id", authData.user.id);

    return json({
      success: true,
      data: {
        mode: "retry",
        endpoint: "flutterwave-transfer-create",
        create_scope: "transfer_retry",
        write_scope: "money_movement",
        response_contract_version: 1,
        contract_generated_at: new Date().toISOString(),
        provider: "flutterwave",
        direction: "payout",
        source: "flutterwave",
        source_locked_to_flutterwave: true,
        source_filter: "flutterwave",
        capabilities: caps,
        transfer_id: providerTransferId,
        status: mappedStatus,
        transfer: res.data,
      },
    });
  }

  const amount = toPositiveNumber(body?.amount);
  const sourceCurrency = String(body?.source_currency || "").trim().toUpperCase();
  const appliesTo = String(body?.applies_to || "").trim().toLowerCase();
  const destinationCountry = String(body?.destination_country || "").trim().toUpperCase();
  const destinationCurrency = String(body?.destination_currency || "").trim().toUpperCase();
  const channel = String(body?.channel || "bank").trim().toLowerCase();
  const accountBank = String(body?.account_bank || "").trim();
  const accountNumber = String(body?.account_number || "").trim();
  const recipientFirstName = String(body?.recipient?.first_name || body?.recipient_first_name || "").trim();
  const recipientLastName = String(body?.recipient?.last_name || body?.recipient_last_name || "").trim();
  const reference = String(body?.reference || "").trim();
  const amountCurrency = appliesTo === "destination_currency" ? destinationCurrency : sourceCurrency;

  if (!amount) return json({ success: false, error: "amount must be > 0" }, 400);
  // No locally guessed minimum. Flutterwave's route validation response is the
  // source of truth for Kenya limits.
  if (!sourceCurrency) return json({ success: false, error: "source_currency is required" }, 400);
  if (!["source_currency", "destination_currency"].includes(appliesTo)) {
    return json({ success: false, error: "applies_to must be source_currency or destination_currency" }, 400);
  }
  if (!destinationCountry) return json({ success: false, error: "destination_country is required" }, 400);
  if (!destinationCurrency) return json({ success: false, error: "destination_currency is required" }, 400);
  if (destinationCountry !== "KE" || destinationCurrency !== "KES") {
    return json({ success: false, code: "kenya_send_only", error: "This controlled payout test supports Kenya in KES only." }, 400);
  }
  if (!["bank", "mobile_money"].includes(channel)) {
    return json({ success: false, error: "channel must be bank or mobile_money" }, 400);
  }
  if (!accountBank) return json({ success: false, error: "account_bank is required" }, 400);
  if (!accountNumber) return json({ success: false, error: "account_number is required" }, 400);
  if (!recipientFirstName || !recipientLastName) {
    return json({ success: false, code: "structured_recipient_name_required", error: "Recipient first name and last name are required." }, 400);
  }
  if (!validRecipientName(recipientFirstName) || !validRecipientName(recipientLastName)) {
    return json({ success: false, code: "invalid_recipient_name", error: "Enter a valid recipient first name and last name." }, 400);
  }
  if (channel === "bank" && !/^[A-Za-z0-9]{7,24}$/.test(accountNumber)) {
    return json({ success: false, code: "invalid_bank_account", error: "Enter a valid destination bank account number." }, 400);
  }
  const mobileMsisdn = accountNumber.startsWith("+") ? accountNumber.slice(1) : accountNumber;
  if (channel === "mobile_money" && !/^[0-9]{6,25}$/.test(mobileMsisdn)) {
    return json({ success: false, code: "invalid_mobile_account", error: "Enter a valid destination mobile money number." }, 400);
  }
  if (channel === "mobile_money" && !/^[A-Za-z0-9]{2,25}$/.test(accountBank)) {
    return json({ success: false, code: "invalid_mobile_network", error: "Select a valid mobile money network." }, 400);
  }
  if (!reference) return json({ success: false, error: "reference is required" }, 400);
  if (!validReference(reference)) {
    return json({
      success: false,
      error: "reference must be 6-42 characters and include only letters, numbers, or hyphens",
    }, 400);
  }

  const { data: profile } = await supa
    .from("user_profiles")
    .select("id, account_type, country, bridge_kyc_status, bridge_kyb_status, bridge_account_status")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (!profile) {
    return json({ success: false, code: "profile_missing", error: "User profile is missing." }, 404);
  }
  const corridorDecision = await evaluateProviderCorridorPolicy(supa, {
    provider: "flutterwave",
    direction: "payout",
    userCountry: profile.country,
    destinationCountry,
    destinationCurrency,
    channel: channel as "bank" | "mobile_money",
    bridgeVerified: isBridgeProfileVerified(profile),
  });
  if (!corridorDecision.allowed) {
    return json(
      { success: false, code: corridorDecision.code, error: corridorDecision.message },
      corridorDecision.code === "policy_lookup_failed" ? 503 : 403,
    );
  }

  const requestMeta = {
    borderpay_user_id: authData.user.id,
    borderpay_source: "flutterwave-transfer-create",
  };

  const res = await flutterwaveCreateTransfer({
    amount,
    applies_to: appliesTo as "source_currency" | "destination_currency",
    source_currency: sourceCurrency,
    channel: channel as "bank" | "mobile_money",
    account_bank: accountBank,
    account_number: accountNumber,
    recipient_first_name: recipientFirstName,
    recipient_last_name: recipientLastName,
    reference,
    narration: body?.narration ? String(body.narration) : undefined,
    callback_url: body?.callback_url ? String(body.callback_url) : undefined,
    sender_id: Deno.env.get("FLW_SENDER_ID") || undefined,
    meta: {
      ...(typeof body?.meta === "object" && body?.meta !== null ? body.meta : {}),
      ...requestMeta,
    },
  });

  if (!res.ok) {
    const isIpGuard = res.error === "flutterwave_ip_not_allowlisted";
    const isInactive = res.error === "flutterwave_account_inactive" || res.error === "flutterwave_auth_error";
    await supa.from("flutterwave_transfers").upsert({
      user_id: authData.user.id,
      direction: "payout",
      reference,
      source: "flutterwave",
      idempotency_key: reference,
      amount,
      currency: amountCurrency,
      destination_country: destinationCountry,
      destination_currency: destinationCurrency,
      channel,
      status: "failed",
      provider_status: null,
      request_payload: {
        amount,
        source_currency: sourceCurrency,
        destination_currency: destinationCurrency,
        applies_to: appliesTo,
        channel,
        account_bank: accountBank,
        account_number_masked: maskAccountNumber(accountNumber),
        recipient_name: { first: recipientFirstName, last: recipientLastName },
        reference,
        narration: body?.narration ? String(body.narration) : null,
      },
      provider_response: res.data ?? {},
      metadata: {
        ...requestMeta,
        corridor_policy: corridorDecision.policy || null,
        provider_stage: (res as any).stage || null,
        provider_error_type: (res as any).providerErrorType || null,
        provider_error_code: (res as any).providerErrorCode || null,
        provider_trace_id: (res as any).traceId || null,
      },
      provider_request_id: (res as any).traceId || null,
      provider_trace_id: (res as any).traceId || null,
      provider_recipient_id: (res as any).recipientId || null,
      provider_http_status: Number.isFinite(res.status) ? res.status : null,
      last_error: res.error || "create_failed",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,source,reference" });

    await recordAfricanRailsOperatorAlert(supa, {
      userId: access.user.id,
      endpoint: "flutterwave-transfer-create",
      code: res.error || "flutterwave_v4_payout_failed",
      message: `V4 payout failed at ${(res as any).stage || "unknown"} stage; trace ${(res as any).traceId || "missing"}.`,
    });

    return json({
      success: false,
      code: isIpGuard
        ? "static_ip_not_ready"
        : (isInactive ? "provider_inactive" : "upstream_error"),
      error: isIpGuard
        ? "This payout route is temporarily unavailable while connectivity is being verified."
        : (isInactive
          ? "This payout route is temporarily unavailable. No funds were sent."
          : userSafeFlutterwavePayoutError(res.error)),
      data: { capabilities: caps },
    }, (isIpGuard || isInactive) ? 503 : 502);
  }

  const responseData = v4TransferData(res.data);
  const providerTransferId = String(responseData?.id || responseData?.transfer_id || "").trim() || null;
  const providerStatus = String(responseData?.status || "").trim() || null;
  const mappedStatus = mapFlutterwaveProviderStatus(providerStatus);

  await supa.from("flutterwave_transfers").upsert({
    user_id: authData.user.id,
    direction: "payout",
    reference,
    provider_transfer_id: providerTransferId,
    source: "flutterwave",
    idempotency_key: reference,
    amount,
    currency: amountCurrency,
    destination_country: destinationCountry,
    destination_currency: destinationCurrency,
    channel,
    status: mappedStatus,
    provider_status: providerStatus,
    request_payload: {
      amount,
      source_currency: sourceCurrency,
      destination_currency: destinationCurrency,
      applies_to: appliesTo,
      channel,
      account_bank: accountBank,
      account_number_masked: maskAccountNumber(accountNumber),
      recipient_name: { first: recipientFirstName, last: recipientLastName },
      reference,
      narration: body?.narration ? String(body.narration) : null,
    },
    provider_response: res.data ?? {},
    metadata: {
      ...requestMeta,
      corridor_policy: corridorDecision.policy || null,
      provider_recipient_id: (res as any).recipientId || null,
      provider_recipient_trace_id: (res as any).recipientTraceId || null,
      provider_trace_id: (res as any).transferTraceId || (res as any).traceId || null,
      provider_fee: responseData?.fee || null,
      idempotency_cache_hit: (res as any).idempotencyCacheHit || false,
    },
    provider_request_id: (res as any).transferTraceId || (res as any).traceId || null,
    provider_trace_id: (res as any).transferTraceId || (res as any).traceId || null,
    provider_recipient_id: (res as any).recipientId || null,
    provider_fee_amount: Number.isFinite(Number(responseData?.fee?.value)) ? Number(responseData.fee.value) : null,
    provider_fee_currency: responseData?.fee?.currency ? String(responseData.fee.currency).toUpperCase() : null,
    provider_http_status: Number.isFinite(res.status) ? res.status : null,
    last_error: null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,source,reference" });

  return json({
    success: true,
    data: {
      mode: "create",
      endpoint: "flutterwave-transfer-create",
      create_scope: "transfer_create",
      write_scope: "money_movement",
      response_contract_version: 1,
      contract_generated_at: new Date().toISOString(),
      provider: "flutterwave",
      direction: "payout",
      source: "flutterwave",
      source_locked_to_flutterwave: true,
      source_filter: "flutterwave",
      capabilities: caps,
      reference,
      transfer_id: providerTransferId,
      status: mappedStatus,
      transfer: res.data,
    },
  });
});
