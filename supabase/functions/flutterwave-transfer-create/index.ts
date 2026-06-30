import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveCreateTransfer,
  flutterwaveRetryTransfer,
  getFlutterwaveCapabilities,
  getFlutterwaveNetworkGuard,
} from "../_shared/providers/flutterwave.ts";
import { evaluateProviderCorridorPolicy } from "../_shared/providers/provider-corridor-policy.ts";

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

function mapTransferState(raw: unknown): "submitted" | "processing" | "completed" | "failed" | "reversed" | "unknown" {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "submitted";
  if (["successful", "success", "completed", "complete", "paid"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(s)) return "failed";
  if (["reversed", "refunded"].includes(s)) return "reversed";
  if (["pending", "processing", "queued", "new", "initiated"].includes(s)) return "processing";
  return "unknown";
}

function transferData(input: any): any {
  return input?.data && typeof input.data === "object" ? input.data : input;
}

function maskAccountNumber(v: string): string {
  const trimmed = String(v || "").trim();
  if (trimmed.length <= 4) return trimmed;
  return `${"*".repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function isBridgeVerified(profile: any): boolean {
  const accountStatus = String(profile?.bridge_account_status || "").toLowerCase();
  if (["active", "approved", "authorized"].includes(accountStatus)) return true;
  const accountType = String(profile?.account_type || "individual").toLowerCase();
  const status = String(accountType === "business" ? profile?.bridge_kyb_status : profile?.bridge_kyc_status || "").toLowerCase();
  return ["approved", "active", "authorized", "verified", "completed", "complete"].includes(status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const caps = getFlutterwaveCapabilities();
  if (!caps.configured || !caps.payout_enabled) {
    return json({
      success: false,
      code: "flutterwave_not_enabled",
      error: "Flutterwave payout rails are not enabled in this environment.",
      data: { capabilities: caps },
    }, 503);
  }

  const networkGuard = getFlutterwaveNetworkGuard("money_movement");
  if (!networkGuard.allowed) {
    return json({
      success: false,
      code: networkGuard.code,
      error: networkGuard.message,
      data: { capabilities: caps, network_guard: networkGuard },
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

  const mode = String(body?.mode || "create").trim().toLowerCase();
  if (mode === "retry") {
    const transferId = String(body?.transfer_id || "").trim();
    const reference = String(body?.reference || "").trim();
    if (!transferId && !reference) {
      return json({ success: false, error: "transfer_id or reference is required for retry mode" }, 400);
    }
    let providerTransferId = transferId;
    if (!providerTransferId && reference) {
      const { data: existing } = await supa
        .from("flutterwave_transfers")
        .select("id, provider_transfer_id, reference")
        .eq("reference", reference)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      providerTransferId = String(existing?.provider_transfer_id || "").trim();
      if (!providerTransferId) {
        return json({ success: false, error: "No provider transfer found for this reference yet." }, 404);
      }
    }

    const res = await flutterwaveRetryTransfer(providerTransferId, body?.retry_payload || {});
    if (!res.ok) {
      await supa
        .from("flutterwave_transfers")
        .update({
          status: "failed",
          provider_response: res.data ?? {},
          last_error: res.error || "retry_failed",
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("provider_transfer_id", providerTransferId)
        .eq("user_id", authData.user.id);
      return json({
        success: false,
        code: "upstream_error",
        error: res.error || "Failed to retry transfer",
        data: { capabilities: caps },
      }, 502);
    }

    const rData = transferData(res.data);
    const providerStatus = String(rData?.status || "");
    const mappedStatus = mapTransferState(providerStatus);
    await supa
      .from("flutterwave_transfers")
      .update({
        status: mappedStatus,
        provider_status: providerStatus || null,
        provider_response: res.data ?? {},
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
        capabilities: caps,
        transfer_id: providerTransferId,
        status: mappedStatus,
        transfer: res.data,
      },
    });
  }

  const amount = toPositiveNumber(body?.amount);
  const currency = String(body?.currency || "").trim().toUpperCase();
  const destinationCountry = String(body?.destination_country || "").trim().toUpperCase();
  const destinationCurrency = String(body?.destination_currency || currency).trim().toUpperCase();
  const channel = String(body?.channel || "bank").trim().toLowerCase();
  const accountBank = String(body?.account_bank || "").trim();
  const accountNumber = String(body?.account_number || "").trim();
  const reference = String(body?.reference || "").trim();

  if (!amount) return json({ success: false, error: "amount must be > 0" }, 400);
  if (!currency) return json({ success: false, error: "currency is required" }, 400);
  if (!destinationCountry) return json({ success: false, error: "destination_country is required" }, 400);
  if (!["bank", "mobile_money"].includes(channel)) {
    return json({ success: false, error: "channel must be bank or mobile_money" }, 400);
  }
  if (!accountBank) return json({ success: false, error: "account_bank is required" }, 400);
  if (!accountNumber) return json({ success: false, error: "account_number is required" }, 400);
  if (!reference) return json({ success: false, error: "reference is required" }, 400);

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
    bridgeVerified: isBridgeVerified(profile),
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
    currency,
    account_bank: accountBank,
    account_number: accountNumber,
    reference,
    narration: body?.narration ? String(body.narration) : undefined,
    callback_url: body?.callback_url ? String(body.callback_url) : undefined,
    debit_currency: body?.debit_currency ? String(body.debit_currency).toUpperCase() : undefined,
    beneficiary_name: body?.beneficiary_name ? String(body.beneficiary_name) : undefined,
    meta: {
      ...(typeof body?.meta === "object" && body?.meta !== null ? body.meta : {}),
      ...requestMeta,
    },
  });

  if (!res.ok) {
    await supa.from("flutterwave_transfers").upsert({
      user_id: authData.user.id,
      direction: "payout",
      reference,
      source: "flutterwave",
      idempotency_key: reference,
      amount,
      currency,
      destination_country: destinationCountry,
      destination_currency: destinationCurrency,
      channel,
      status: "failed",
      provider_status: null,
      request_payload: {
        amount,
        currency,
        account_bank: accountBank,
        account_number_masked: maskAccountNumber(accountNumber),
        reference,
        narration: body?.narration ? String(body.narration) : null,
      },
      provider_response: res.data ?? {},
      metadata: { ...requestMeta, corridor_policy: corridorDecision.policy || null },
      last_error: res.error || "create_failed",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,reference" });

    return json({
      success: false,
      code: "upstream_error",
      error: res.error || "Failed to create transfer",
      data: { capabilities: caps },
    }, 502);
  }

  const responseData = transferData(res.data);
  const providerTransferId = String(responseData?.id || responseData?.transfer_id || "").trim() || null;
  const providerStatus = String(responseData?.status || "").trim() || null;
  const mappedStatus = mapTransferState(providerStatus);

  await supa.from("flutterwave_transfers").upsert({
    user_id: authData.user.id,
    direction: "payout",
    reference,
    provider_transfer_id: providerTransferId,
    source: "flutterwave",
    idempotency_key: reference,
    amount,
    currency,
    destination_country: destinationCountry,
    destination_currency: destinationCurrency,
    channel,
    status: mappedStatus,
    provider_status: providerStatus,
    request_payload: {
      amount,
      currency,
      account_bank: accountBank,
      account_number_masked: maskAccountNumber(accountNumber),
      reference,
      narration: body?.narration ? String(body.narration) : null,
    },
    provider_response: res.data ?? {},
    metadata: { ...requestMeta, corridor_policy: corridorDecision.policy || null },
    last_error: null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,reference" });

  return json({
    success: true,
    data: {
      mode: "create",
      capabilities: caps,
      reference,
      transfer_id: providerTransferId,
      status: mappedStatus,
      transfer: res.data,
    },
  });
});
