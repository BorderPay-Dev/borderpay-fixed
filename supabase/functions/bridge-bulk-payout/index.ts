// bridge-bulk-payout v1 — batch payouts (payroll / supplier / contractor /
// marketplace / creator) over the SAME validated single-transfer rail.
//
// This does NOT invent a new money path. It runs the identical gates and the
// identical `bridgeProvider.createTransfer` + `upsert_bridge_transaction` that
// `bridge-transfer` uses, once PER recipient, sequentially, collecting a
// per-item result. One bad row never aborts the batch and never double-pays a
// good row (each item carries its own idempotency key).
//
// POST body:
//   {
//     source_currency: "USDC",                  // currency debited for every item
//     items: [
//       {
//         destination: { payment_rail, currency, chain?, address?, bank_account? },
//         amount:          "100.00",            // decimal string, per recipient
//         idempotency_key: string,              // REQUIRED, unique per recipient intent
//         label?:          string               // optional payee label (memo only)
//       }, ...
//     ]
//   }
//
// Server gate `BRIDGE_TRANSFERS_ENABLED="true"` is required (same as transfers).
// developer_fee is enforced server-side; never taken from the client.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import {
  bridgeDeveloperFeePercent,
  bridgeTransferFlatFeeAmountUsd,
  isUsdDenominatedCurrency,
} from "../_shared/fees/schedule.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { requireMinimumWalletBalance } from "../_shared/funding-gate.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";
import { BridgeProviderError } from "../_shared/providers/bridge.ts";

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

const MAX_ITEMS = 250;   // batch cap — keeps the function within its time budget

function isValidIdempotencyKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length < 8 || v.length > 128) return false;
  return /^[\x21-\x7E]+$/.test(v);
}
function transfersEnabled(): boolean {
  return (Deno.env.get("BRIDGE_TRANSFERS_ENABLED") || "").toLowerCase() === "true";
}

/** Strict positive decimal parser for money values.
 *  Rejects exponent notation / NaN / Infinity and bounds precision. */
function parsePositiveAmount(v: unknown): { raw: string; numeric: number } | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const raw = String(v).trim();
  if (!/^\d+(\.\d{1,12})?$/.test(raw)) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { raw, numeric };
}

function mapBulkItemFailure(
  error: unknown,
  options?: { isBusiness?: boolean },
): {
  code: string;
  message: string;
  provider_code?: string;
  bridge_request_id?: string;
  expected_verification_status?: "approved";
} {
  const isBusiness = options?.isBusiness === true;
  if (error instanceof BridgeProviderError) {
    const bridgeCode = String(error.bridge_code || "").toLowerCase();
    const bridgeRequestId = error.request_id || undefined;
    switch (bridgeCode) {
      case "has_not_accepted_tos":
        return {
          code: "tos_required",
          message: "Terms of Service acceptance is required before sending payouts.",
          provider_code: bridgeCode,
          ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
        };
      case "requires_active_kyc_status":
        return {
          code: "kyc_not_approved",
          message: isBusiness
            ? "Business verification is required before sending payouts."
            : "Identity verification is required before sending payouts.",
          provider_code: bridgeCode,
          ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
          expected_verification_status: "approved",
        };
      case "deactivated_external_account":
        return {
          code: "external_account_deactivated",
          message: "Destination account is deactivated. Choose another destination.",
          provider_code: bridgeCode,
          ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
        };
      case "insufficient_funds":
      case "insufficient_balance":
        return {
          code: "insufficient_funds",
          message: "Insufficient balance for this payout.",
          provider_code: bridgeCode,
          ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
        };
      default:
        return {
          code: "provider_error",
          message: "Unable to process this payout item right now.",
          provider_code: bridgeCode || undefined,
          ...(bridgeRequestId ? { bridge_request_id: bridgeRequestId } : {}),
        };
    }
  }
  return { code: "item_failed", message: "Unable to process this payout item right now." };
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

  // Hard gate — fail closed before any auth/Bridge side effects.
  if (!transfersEnabled()) {
    return json({ success: false, code: "transfer_not_enabled",
      error: "Money movement is not enabled in this environment yet.",
      summary: {
        code: "transfer_not_enabled",
      },
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
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

  let body: any;
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

  const sourceCurrency = body?.source_currency;
  const items: any[] = Array.isArray(body?.items) ? body.items : [];
  if (!sourceCurrency || items.length === 0) {
    return json({
      success: false,
      code: "invalid_batch_payload",
      error: "Source currency and a non-empty payout items list are required.",
      required_fields: ["source_currency", "items[]"],
      summary: {
        code: "invalid_batch_payload",
      },
    }, 400);
  }
  if (items.length > MAX_ITEMS) {
    return json({ success: false, code: "batch_too_large",
      error: `Batch exceeds ${MAX_ITEMS} recipients. Split into smaller batches.`,
      summary: {
        code: "batch_too_large",
      },
    }, 400);
  }

  // Validate EVERY item up front — reject the whole batch on a malformed row so
  // the operator fixes the file rather than discovering bad rows mid-run.
  const seenKeys = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = i + 1;
    if (!it?.amount || !it?.destination?.currency) {
      return json({
        success: false,
        code: "invalid_batch_row_required_fields",
        error: "Each payout row requires amount and destination currency.",
        row,
        summary: {
          code: "invalid_batch_row_required_fields",
          row,
        },
      }, 400);
    }
    const parsedAmount = parsePositiveAmount(it.amount);
    if (!parsedAmount) {
      return json({
        success: false,
        code: "invalid_batch_row_amount",
        error: "Amount must be a positive decimal value.",
        row,
        summary: {
          code: "invalid_batch_row_amount",
          row,
        },
      }, 400);
    }
    it.__parsedAmount = parsedAmount;
    if (!isValidIdempotencyKey(it.idempotency_key)) {
      return json({
        success: false,
        code: "invalid_batch_row_idempotency_key",
        error: "Each payout row requires a valid idempotency key.",
        row,
        summary: {
          code: "invalid_batch_row_idempotency_key",
          row,
        },
      }, 400);
    }
    if (seenKeys.has(it.idempotency_key)) {
      return json({
        success: false,
        code: "duplicate_batch_row_idempotency_key",
        error: "Duplicate idempotency key in payout batch.",
        row,
        summary: {
          code: "duplicate_batch_row_idempotency_key",
          row,
        },
      }, 400);
    }
    seenKeys.add(it.idempotency_key);
  }

  // Account-level gates — checked ONCE for the whole batch (same as a single send).
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
  const { data: maintenance } = await supa
    .from("user_profiles")
    .select("maintenance_overdue,wallet_maintenance_overdue,maintenance_grace_expired")
    .eq("id", user.id)
    .maybeSingle();

  if (isBridgeBlocked(profile?.country)) return json(bridgeCountryBlockResponse(profile!.country!), 403);
  if (maintenance?.maintenance_overdue === true || maintenance?.wallet_maintenance_overdue === true) {
    return json({ success: false, code: "maintenance_due",
      error: "Clear your account maintenance fees before sending. Outbound transfers are paused until then.",
      summary: {
        code: "maintenance_due",
      },
    }, 402);
  }
  if (maintenance?.maintenance_grace_expired === true) {
    return json({ success: false, code: "maintenance_grace_expired",
      error: "Your account is restricted due to prolonged unpaid maintenance. Clear dues to restore outbound transfers.",
      summary: {
        code: "maintenance_grace_expired",
      },
    }, 402);
  }
  logControlledBridgeTraffic("bridge-bulk-payout", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    return json({
      success: false,
      code: "no_customer",
      error: "Complete account setup before sending payouts",
      required_state: "bridge_customer_created",
      summary: {
        code: "no_customer",
      },
    }, 409);
  }
  const isBusiness = profile.account_type === "business";
  if (profile.verification_status !== "approved") {
    const verificationLabel = isBusiness ? "KYB" : "KYC";
    return json({
      success: false,
      code: "kyc_not_approved",
      error: `${verificationLabel} not approved yet`,
      expected_verification_status: "approved",
      summary: {
        code: "kyc_not_approved",
      },
    }, 409);
  }
  {
    const gate = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!gate.allowed) return json(gate.body, gate.status);
  }

  // Process each recipient sequentially. A per-item failure is recorded and the
  // batch continues — it never aborts the run or retries a succeeded row.
  const results: any[] = [];
  let submitted = 0, failed = 0, totalAmount = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const row = i + 1;
    const idem = `borderpay:bulk:${user.id}:${it.idempotency_key}`;

    try {
      // Idempotent replay guard — if we already created this item, reuse it.
      const { data: existing } = await supa
        .from("transactions")
        .select("bridge_transfer_id, status")
        .eq("user_id", user.id)
        .eq("metadata->>idempotency_key", idem)
        .maybeSingle();
      if (existing?.bridge_transfer_id) {
        results.push({ row, label: it.label ?? null, transfer_id: existing.bridge_transfer_id,
          state: existing.status === "completed" ? "succeeded" : existing.status === "failed" ? "failed" : "pending",
          replayed: true });
        submitted++; totalAmount += it.__parsedAmount?.numeric ?? 0;
        continue;
      }

      const sourceRail    = it.source_payment_rail || "stablecoin";
      const devFeePercent = bridgeDeveloperFeePercent(sourceRail, sourceCurrency);
      const applyFlatUsdFee = isUsdDenominatedCurrency(sourceCurrency);
      const devFeeFlatAmount = applyFlatUsdFee
        ? bridgeTransferFlatFeeAmountUsd(it.__parsedAmount.numeric)
        : undefined;

      const result = await bridgeProvider.createTransfer({
        on_behalf_of: profile.bridge_customer_id,
        source: {
          customer_id:  profile.bridge_customer_id,
          payment_rail: sourceRail,
          currency:     sourceCurrency,
          chain:        it.source_chain,
          amount:       it.__parsedAmount.raw,
        },
        destination:     it.destination,
        developer_fee:   {
          percentage: devFeePercent,
          ...(devFeeFlatAmount ? { flat_amount: devFeeFlatAmount } : {}),
        },
        idempotency_key: idem,
      });

      const mapped = mapBridgeTransferState(result.state);
      const { error: upsertErr } = await supa.rpc("upsert_bridge_transaction", {
        p_user_id:            user.id,
        p_bridge_transfer_id: result.transfer_id,
        p_amount:             it.__parsedAmount.raw,
        p_currency:           sourceCurrency,
        p_status:             mapped.transactionStatus,
        p_metadata:           {
          idempotency_key: idem,
          bulk: true,
          label: it.label ?? null,
          provider_state: mapped.providerState,
          provider_state_recognized: mapped.recognized,
          raw: result.raw,
        },
        p_description:        it.label ? `Bulk payout — ${it.label}` : "Bulk payout",
      });
      if (upsertErr) {
        results.push({ row, label: it.label ?? null, state: "persistence_failed",
          transfer_id: result.transfer_id, error: "Transfer accepted but local sync failed for this item." });
        failed++;
        continue;
      }

      results.push({
        row,
        label: it.label ?? null,
        transfer_id: result.transfer_id,
        state: mapped.transactionStatus === "completed" ? "succeeded" : mapped.transactionStatus,
        provider_state: mapped.providerState,
      });
      submitted++; totalAmount += it.__parsedAmount?.numeric ?? 0;
    } catch (e) {
      const mapped = mapBulkItemFailure(e, { isBusiness });
      results.push({
        row,
        label: it.label ?? null,
        state: "failed",
        code: mapped.code,
        error: mapped.message,
        ...(mapped.expected_verification_status
          ? { expected_verification_status: mapped.expected_verification_status }
          : {}),
        ...(mapped.provider_code ? { provider_code: mapped.provider_code } : {}),
        ...(mapped.bridge_request_id ? { bridge_request_id: mapped.bridge_request_id } : {}),
      });
      failed++;
    }
  }

  return json({
    success: true,
    code: "bulk_payout_processed",
    summary: {
      code: "bulk_payout_processed",
      total: items.length,
      submitted,
      failed,
      total_amount: totalAmount,
      currency: sourceCurrency,
    },
    data: {
      results,
      summary: {
        code: "bulk_payout_processed",
        total: items.length,
        submitted,
        failed,
        total_amount: totalAmount,
        currency: sourceCurrency,
      },
    },
  });
});
