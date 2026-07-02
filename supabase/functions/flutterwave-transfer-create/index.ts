import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flutterwaveCreateTransfer,
  flutterwaveRetryTransfer,
  getFlutterwaveCapabilities,
} from "../_shared/providers/flutterwave.ts";
import { mapFlutterwaveErrorResponse } from "../_shared/providers/flutterwave-error-response.ts";

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

  const accountType = String(body?.account_type || "individual").toLowerCase();
  if (!["individual", "business"].includes(accountType)) {
    return json({ success: false, code: "invalid_account_type", error: "account_type must be individual or business." }, 400);
  }

  const mode = String(body?.mode || "create").trim().toLowerCase();
  if (!["create", "retry"].includes(mode)) {
    return json({ success: false, code: "invalid_mode", error: "mode must be create or retry" }, 400);
  }
  if (mode === "retry") {
    const transferId = String(body?.transfer_id || "").trim();
    if (!transferId) return json({ success: false, error: "transfer_id is required for retry mode" }, 400);
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
        transfer: res.data,
      },
    });
  }

  const amount = toPositiveNumber(body?.amount);
  const currency = String(body?.currency || "").trim().toUpperCase();
  const accountBank = String(body?.account_bank || "").trim();
  const accountNumber = String(body?.account_number || "").trim();
  const reference = String(body?.reference || "").trim();

  if (!amount) return json({ success: false, error: "amount must be > 0" }, 400);
  if (!currency) return json({ success: false, error: "currency is required" }, 400);
  if (!accountBank) return json({ success: false, error: "account_bank is required" }, 400);
  if (!accountNumber) return json({ success: false, error: "account_number is required" }, 400);
  if (!reference) return json({ success: false, error: "reference is required" }, 400);

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
    ...(() => {
      const inputMeta = typeof body?.meta === "object" && body?.meta !== null ? body.meta : {};
      return {
        meta: {
          ...inputMeta,
          borderpay_user_id: authData.user.id,
          borderpay_account_type: accountType,
          borderpay_transfer_reference: reference,
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
      provider_request_id: res.requestId || null,
      transfer: res.data,
    },
  });
});
