// bridge-transfer v3 — server-side feature flag + RPC-backed upsert.
//
// POST body:
//   {
//     source:         { payment_rail, currency, chain?, amount },  // amount = decimal string
//     destination:    { payment_rail, currency, chain?, address?, bank_account? },
//     idempotency_key: string   // REQUIRED. Client-provided.
//   }
//
//   NOTE: developer_fee is NOT accepted from the client. It is computed and
//   enforced server-side from the canonical schedule in _shared/fees/schedule.ts
//   (percent + USD flat band where applicable). Any developer_fee in the body
//   is ignored.
//
// Feature-flag gate (P0.2):
//
//   Stablecoin send is considered NOT LIVE until a sandbox evidence
//   package is attached and approved. UI disable alone is not enough —
//   any authenticated approved user can call this endpoint directly with
//   a JWT. v3 reads the env `BRIDGE_TRANSFERS_ENABLED` and fails closed
//   with 503 `transfer_not_enabled` unless the flag is the literal
//   string `"true"`. The flag is per-environment and can be flipped
//   to enable smoke tests for a single operator without redeploying the
//   function.
//
// Money-movement idempotency policy:
//
//   The earlier version generated a fresh `crypto.randomUUID()` per
//   request. That defeats Bridge's `Idempotency-Key` header — a network
//   retry from the client created a SECOND Bridge transfer for the same
//   user intent. Real money. Unacceptable.
//
//   v2+ requires the client to supply a stable `idempotency_key` in the
//   request body. The client is expected to:
//     • Generate one key per user *intent* (e.g. one Confirm tap on the
//       Send screen) — typically a UUIDv4 stored in form state.
//     • Re-send the same key on retries / timeouts / "Confirm" double-
//       taps for the same transfer.
//
//   Acceptable formats: any printable-ASCII string 8-128 chars. We
//   canonicalise to `borderpay:transfer:<user.id>:<client_key>` so the
//   namespace can't collide across users even if two users happened to
//   pick the same key.
//
//   If the body is missing `idempotency_key`, we refuse with 400
//   `idempotency_key_required`. Fail closed.
//
//   Additionally we add a DB pre-check: if `transactions` already has a
//   row with the same `metadata->>idempotency_key` for this user, we
//   return the existing transfer_id without calling Bridge again. This
//   guards against the case where Bridge accepted on the first call but
//   we crashed before responding to the client.
//
// Persistence (P0.3):
//
//   The transactions row is written via the `upsert_bridge_transaction`
//   plpgsql RPC, not a PostgREST upsert. The unique index on
//   `bridge_transfer_id` is PARTIAL
//   (`WHERE provider='bridge' AND bridge_transfer_id IS NOT NULL`) and
//   PostgREST cannot infer partial unique constraints for `onConflict`.
//   The RPC expresses the same predicate explicitly in `ON CONFLICT ...
//   WHERE provider = 'bridge' AND bridge_transfer_id IS NOT NULL`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider, BridgeProviderError } from "../_shared/providers/bridge.ts";
import {
  bridgeDeveloperFeePercent,
  bridgeTransferFlatFeeAmountUsd,
  isUsdDenominatedCurrency,
} from "../_shared/fees/schedule.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import {
  BRIDGE_FX_FALLBACK_SUPPORTED_PAIRS,
  loadSupportedFxPairsFromSettings,
} from "../_shared/providers/bridge-fx-policy.ts";
import { requireMinimumWalletBalance } from "../_shared/funding-gate.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function fxLog(stage: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    service: "bridge-transfer",
    stage,
    at: new Date().toISOString(),
    ...detail,
  }));
}

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Strict idempotency-key validation: non-empty string, ≤128 chars,
 *  printable ASCII only (no surprises across header / DB serialization). */
function isValidIdempotencyKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length < 8 || v.length > 128) return false;
  return /^[\x21-\x7E]+$/.test(v);
}

/** Server-side gate: `BRIDGE_TRANSFERS_ENABLED` must be the literal string
 *  "true" to allow any transfer. Anything else (unset, "false", "1", null)
 *  fails closed with HTTP 503. This is the only path that controls
 *  whether transfers can execute; the UI disable is decorative. */
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

  // Hard server gate. Fail closed before any auth or Bridge call so we
  // can't leak side effects (idempotency rows, log lines) while disabled.
  if (!transfersEnabled()) {
    return json({
      success: false,
      code:    "transfer_not_enabled",
      error:   "Money movement is not enabled in this environment. Awaiting sandbox evidence sign-off.",
    }, 503);
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
  fxLog("request_received", { user_id: user.id, method: req.method });

  let body: any;
  try { body = await req.json(); } catch {
    return json({
      success: false,
      code: "invalid_json_payload",
      error: "Invalid JSON payload",
    }, 400);
  }
  if (!body?.source?.amount || !body?.source?.currency || !body?.destination?.currency) {
    return json({
      success: false,
      code: "invalid_transfer_payload",
      error: "source.amount, source.currency, destination.currency required",
      required_fields: ["source.amount", "source.currency", "destination.currency"],
    }, 400);
  }
  const amount = parsePositiveAmount(body?.source?.amount);
  if (!amount) {
    return json({
      success: false,
      code: "invalid_amount_format",
      error: "source.amount must be a positive decimal number (up to 12 dp, no exponent)",
    }, 400);
  }
  if (!isValidIdempotencyKey(body?.idempotency_key)) {
    return json({
      success: false,
      code:    "idempotency_key_required",
      error:   "A client-provided idempotency_key (8-128 printable ASCII chars) is required for transfers.",
    }, 400);
  }
  // FX policy gate (wallet->wallet conversion only): only allow documented
  // supported pairs for conversion-style routes. Other transfer rails remain
  // unaffected (send/payout/onramp/offramp).
  const srcRail = String(body?.source?.payment_rail || "").toLowerCase();
  const dstRail = String(body?.destination?.payment_rail || "").toLowerCase();
  const srcCcy = String(body?.source?.currency || "").toUpperCase();
  const dstCcy = String(body?.destination?.currency || "").toUpperCase();
  if (srcRail === "bridge_wallet" && dstRail === "bridge_wallet" && srcCcy !== dstCcy) {
    const pair = `${srcCcy}_${dstCcy}`;
    const configuredPairs = await loadSupportedFxPairsFromSettings(supa);
    const allowedPairs = configuredPairs ?? BRIDGE_FX_FALLBACK_SUPPORTED_PAIRS; // fallback only when setting is absent
    if (!allowedPairs.has(pair)) {
      return json({
        success: false,
        code: "unsupported_pair",
        error: "This conversion pair is currently unavailable.",
        source_currency: srcCcy,
        destination_currency: dstCcy,
      }, 400);
    }
  }
  fxLog("validation_passed", {
    user_id: user.id,
    source_currency: body?.source?.currency ?? null,
    destination_currency: body?.destination?.currency ?? null,
    source_payment_rail: body?.source?.payment_rail ?? "stablecoin",
    destination_payment_rail: body?.destination?.payment_rail ?? null,
  });

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    return json({ success: false, ...identity.failure }, 409);
  }
  const profile = identity.context;
  const { data: maintenance } = await supa
    .from("user_profiles")
    .select("maintenance_overdue,wallet_maintenance_overdue,maintenance_grace_expired")
    .eq("id", user.id)
    .maybeSingle();
  if (isBridgeBlocked(profile?.country)) {
    return json(bridgeCountryBlockResponse(profile!.country!), 403);
  }
  // Maintenance gate (#3): block OUTBOUND money movement while a virtual-account
  // maintenance fee is unpaid. Inbound/top-ups stay open so the user can clear it.
  if (maintenance?.maintenance_overdue === true || maintenance?.wallet_maintenance_overdue === true) {
    return json({
      success: false,
      code:    "maintenance_due",
      error:   "Top up your wallet to cover account maintenance fees before sending. Outbound transfers are paused until then.",
    }, 402);
  }
  if (maintenance?.maintenance_grace_expired === true) {
    return json({
      success: false,
      code: "maintenance_grace_expired",
      error: "Your account is restricted due to prolonged unpaid maintenance. Clear dues to restore outbound transfers.",
    }, 402);
  }
  logControlledBridgeTraffic("bridge-transfer", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    return json({
      success: false,
      code: "no_customer",
      error: "Complete account setup before sending transfers",
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

  // Paid gate: outbound transfers require an activated (paid) plan. In the Wise
  // funnel KYC can be free, so this is what keeps money movement paid-gated —
  // an unpaid user gets `plan_required` → the app shows the activation popup.
  const isBusiness = profile.account_type === "business";
  {
    const __planGate = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!__planGate.allowed) return json(__planGate.body, __planGate.status);
  }

  // Canonicalise: include user.id so two users can't collide on the same key.
  const clientKey = body.idempotency_key as string;
  const idem      = `borderpay:transfer:${user.id}:${clientKey}`;

  // Corridor note (#B1): African corridors settle via EXTERNAL STABLECOIN
  // (USDT/USDC to a user-supplied address on a supported network) — these flow
  // through the standard Bridge stablecoin transfer below (destination =
  // stablecoin rail + chain + address), no local-bank aggregator. International
  // fiat payouts use a fiat destination. Bridge handles both natively. The
  // customer-facing fee tier is computed at checkout (utils/fees/engine.ts).

  // DB pre-check: if we already have a transactions row for this idempotency
  // key, return the previous transfer_id without touching Bridge. Guards
  // against retries where we crashed between Bridge accept and our DB write.
  {
    const { data: existing } = await supa
      .from("transactions")
      .select("bridge_transfer_id, status")
      .eq("user_id", user.id)
      .eq("metadata->>idempotency_key", idem)
      .maybeSingle();
    if (existing?.bridge_transfer_id) {
      fxLog("idempotent_replay", {
        user_id: user.id,
        transfer_id: existing.bridge_transfer_id,
        idempotency_key: idem,
      });
      return json({
        success: true,
        data: {
          transfer_id: existing.bridge_transfer_id,
          state:       existing.status === "completed" ? "succeeded"
                      : existing.status === "failed"   ? "failed"
                      :                                  "pending",
          replayed:    true,
        },
      });
    }
  }

  // BorderPay developer fee is enforced SERVER-SIDE and is NOT taken from the
  // request body — a client could otherwise omit or lower it. Bridge deducts:
  //   • developer_fee_percent (all supported rails)
  //   • developer_fee_amount (flat USD bands, USD-denominated sources only)
  //
  // Percent schedule:
  //   • stablecoin rail (USDT/USDC/…) → 0.99% (fixed)
  //   • fiat rail (ach/wire/sepa)     → 2.5%
  //
  // Flat USD schedule (applies only from $10+):
  //   • $10–$50   -> $0.50
  //   • $51–$100  -> $1.00
  //   • $101–$500 -> $2.00
  //   • $501–$1000-> $3.00
  //   • $1001+    -> $4.00
  //
  // The canonical schedule lives in _shared/fees/schedule.ts.
  const sourceRail    = body.source.payment_rail || "stablecoin";
  const devFeePercent = bridgeDeveloperFeePercent(sourceRail, body.source.currency);
  const applyFlatUsdFee = isUsdDenominatedCurrency(body.source.currency);
  const devFeeFlatAmount = applyFlatUsdFee
    ? bridgeTransferFlatFeeAmountUsd(amount.numeric)
    : undefined;

  try {
    fxLog("bridge_request_sent", {
      user_id: user.id,
      idempotency_key: idem,
      source_payment_rail: sourceRail,
      destination_payment_rail: body?.destination?.payment_rail ?? null,
      amount: amount.raw,
      currency: body.source.currency,
      developer_fee_percent: devFeePercent,
      developer_fee_flat_amount: devFeeFlatAmount ?? null,
    });
    const result = await bridgeProvider.createTransfer({
      on_behalf_of: profile.bridge_customer_id,
      source: {
        customer_id:  profile.bridge_customer_id,
        payment_rail: sourceRail,
        currency:     body.source.currency,
        chain:        body.source.chain,
        from_address: body.source.from_address,
        bridge_wallet_id: body.source.bridge_wallet_id,
        external_account_id: body.source.external_account_id,
        amount:       amount.raw,
      },
      destination:     body.destination,
      developer_fee:   {
        percentage: devFeePercent,
        ...(devFeeFlatAmount ? { flat_amount: devFeeFlatAmount } : {}),
      },
      // Pass the same canonical key to Bridge so Bridge's own idempotency
      // store dedupes retries too. The shared bridge-client forwards this
      // as the HTTP `Idempotency-Key` header.
      idempotency_key: idem,
    });

    // Persist via the upsert_bridge_transaction RPC. PostgREST upsert
    // cannot infer the partial unique index on bridge_transfer_id
    // (which is `WHERE provider='bridge' AND bridge_transfer_id IS NOT NULL`);
    // the RPC expresses that predicate explicitly in its ON CONFLICT.
    const mapped = mapBridgeTransferState(result.state);
    fxLog("bridge_response_received", {
      user_id: user.id,
      transfer_id: result.transfer_id,
      provider_state: mapped.providerState,
      internal_state: mapped.transactionStatus,
      recognized_state: mapped.recognized,
    });
    const { error: upsertErr } = await supa.rpc("upsert_bridge_transaction", {
      p_user_id:            user.id,
      p_bridge_transfer_id: result.transfer_id,
      p_amount:             amount.raw,
      p_currency:           body.source.currency,
      p_status:             mapped.transactionStatus,
      p_metadata:           {
        idempotency_key: idem,
        transaction_type: "fx_conversion",
        flow: "stablecoin_sandwich",
        provider_state:  mapped.providerState,
        provider_state_recognized: mapped.recognized,
        raw: result.raw,
      },
      p_description:        null,
    });
    if (upsertErr) {
      // Bridge already accepted the transfer — surface the persistence
      // failure but with the transfer_id so the client can be reconciled.
      return json({
        success: false,
        code:    "persistence_failed",
        error:   "Transfer was accepted but local sync failed. Please retry to refresh status.",
        bridge_transfer_id: result.transfer_id,
      }, 500);
    }
    fxLog("transfer_id_stored", {
      user_id: user.id,
      transfer_id: result.transfer_id,
      internal_state: mapped.transactionStatus,
      idempotency_key: idem,
    });
    fxLog("transaction_created", {
      user_id: user.id,
      transfer_id: result.transfer_id,
      internal_status: mapped.transactionStatus,
    });

    return json({
      success: true,
      data: {
        transfer_id:    result.transfer_id,
        state:          mapped.transactionStatus === "completed" ? "succeeded" : mapped.transactionStatus,
        provider_state: mapped.providerState,
      },
    });
  } catch (e) {
    if (e instanceof BridgeProviderError) {
      const bridgeCode = String(e.bridge_code || "").toLowerCase();
      const bridgeStatus = Number(e.status || 0);
      fxLog("bridge_request_failed_mapped", {
        user_id: user.id,
        idempotency_key: idem,
        bridge_code: bridgeCode || null,
        bridge_status: bridgeStatus || null,
        bridge_request_id: e.request_id ?? null,
      });

      const mapped = (() => {
        switch (bridgeCode) {
          case "has_not_accepted_tos":
            return { status: 409, code: "tos_required", error: "Please accept Terms of Service before sending funds." };
          case "requires_active_kyc_status":
            return {
              status: 409,
              code: "kyc_not_approved",
              error: isBusiness
                ? "Business verification is required before sending funds."
                : "Identity verification is required before sending funds.",
              expected_verification_status: "approved",
            };
          case "deactivated_external_account":
            return { status: 409, code: "external_account_deactivated", error: "The selected destination account is deactivated. Choose another destination." };
          case "missing_required_endorsements":
          case "endorsement_requirements_not_met":
          case "cards_endorsement_approval_required":
            return { status: 403, code: "endorsement_required", error: "This transfer route is not enabled for your account yet." };
          case "developer_limits_exceeded":
            return { status: 403, code: "limits_exceeded", error: "Transfer limit reached for this account. Try a smaller amount or retry later." };
          case "duplicate_record":
          case "not_truly_idempotent":
            return { status: 409, code: "idempotency_conflict", error: "Duplicate transfer request detected. Please retry from the latest confirmation state." };
          case "invalid_parameters":
          case "invalid_json":
          case "bad_request":
          case "unprocessable_entity":
            return { status: 400, code: bridgeCode || "invalid_request", error: "Transfer details are invalid. Please review the fields and try again." };
          case "resource_state_conflict":
            return { status: 409, code: "resource_state_conflict", error: "This transfer cannot be processed in its current state. Please retry shortly." };
          case "external_dependency_failed":
            return { status: 502, code: "provider_dependency_failed", error: "Transfer provider is temporarily unavailable. Please try again shortly." };
          case "not_allowed":
            return { status: 403, code: "route_not_enabled", error: "This transfer route is not enabled for your account." };
          default:
            break;
        }
        if (bridgeStatus >= 500 || bridgeStatus === 424 || bridgeStatus === 503) {
          return { status: 502, code: "provider_unavailable", error: "Transfer service is temporarily unavailable. Please retry." };
        }
        if (bridgeStatus >= 400 && bridgeStatus < 500) {
          return { status: 400, code: "transfer_rejected", error: "Transfer request was rejected. Please review details and try again." };
        }
        return { status: 502, code: "provider_error", error: "Unable to process transfer right now. Please retry." };
      })();

      return json(
        {
          success: false,
          code: mapped.code,
          error: mapped.error,
          ...(mapped.expected_verification_status
            ? { expected_verification_status: mapped.expected_verification_status }
            : {}),
          provider_code: bridgeCode || undefined,
          bridge_request_id: e.request_id || undefined,
        },
        mapped.status,
      );
    }

    fxLog("bridge_request_failed", {
      user_id: user.id,
      idempotency_key: idem,
      error: (e as Error).message,
    });
    return json({
      success: false,
      code: "transfer_internal_error",
      error: "Unable to process transfer right now. Please retry.",
    }, 502);
  }
});
