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
//   (stablecoin 0.99% / fiat 2.5%). Any developer_fee in the body is ignored.
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
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";
import {
  isCryptoToCryptoTransfer,
  validateBridgePayout,
} from "../_shared/bridge-payout-validator.ts";

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

async function insertTransferNotification(input: {
  userId: string;
  transferId: string;
  amount: string;
  currency: string;
  state: string;
}) {
  const { data: existing } = await supa
    .from("notifications")
    .select("id")
    .eq("user_id", input.userId)
    .eq("type", "transaction")
    .contains("metadata", { bridge_transfer_id: input.transferId })
    .maybeSingle();
  if (existing?.id) return;

  await supa.from("notifications").insert({
    user_id: input.userId,
    type: "transaction",
    title: "Transfer submitted",
    body: `Transfer of ${input.amount} ${input.currency} is ${input.state}.`,
    metadata: {
      source: "bridge",
      bridge_transfer_id: input.transferId,
      amount: input.amount,
      currency: input.currency,
      state: input.state,
    },
  });
}

async function insertRecipientTransferNotification(input: {
  recipientUserId: string;
  transferId: string;
  amount: string;
  currency: string;
  senderEmail?: string | null;
  state: string;
}) {
  const { data: existing } = await supa
    .from("notifications")
    .select("id")
    .eq("user_id", input.recipientUserId)
    .eq("type", "transaction")
    .contains("metadata", { bridge_transfer_id: input.transferId, direction: "credit" })
    .maybeSingle();
  if (existing?.id) return;

  await supa.from("notifications").insert({
    user_id: input.recipientUserId,
    type: "transaction",
    title: "Payment received",
    body: `${input.amount} ${input.currency} received${input.senderEmail ? ` from ${input.senderEmail}` : ""}.`,
    metadata: {
      source: "bridge",
      direction: "credit",
      flow: "wallet_to_wallet",
      bridge_transfer_id: input.transferId,
      amount: input.amount,
      currency: input.currency,
      sender_email: input.senderEmail ?? null,
      state: input.state,
    },
  });
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

async function resolveSourceBridgeWalletId(input: {
  bridgeCustomerId: string;
  currency: string;
  chain?: string | null;
  providedWalletId?: string | null;
}): Promise<{ ok: true; bridge_wallet_id: string } | { ok: false; status: number; body: Record<string, unknown> }> {
  const provided = String(input.providedWalletId || "").trim();
  if (provided) return { ok: true, bridge_wallet_id: provided };

  const currency = String(input.currency || "").trim().toUpperCase();
  const chain = String(input.chain || "").trim().toLowerCase();
  if (!currency) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "source_wallet_required",
        error: "Source wallet currency is required.",
      },
    };
  }

  let query = supa
    .from("bridge_wallets")
    .select("bridge_wallet_id,status")
    .eq("bridge_customer_id", input.bridgeCustomerId)
    .ilike("currency", currency)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (chain) query = query.ilike("chain", chain);
  const { data, error } = await query.maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        code: "source_wallet_lookup_failed",
        error: "Could not verify the source wallet. Please try again.",
      },
    };
  }
  if (!data?.bridge_wallet_id) {
    const routeLabel = chain ? `${currency} wallet on ${chain.toUpperCase()}` : `${currency} wallet`;
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        code: "source_wallet_not_found",
        error: `${routeLabel} is not available for this account yet.`,
      },
    };
  }
  const status = String(data.status || "active").toLowerCase();
  if (["inactive", "disabled", "closed", "archived", "blocked", "suspended", "deactivated"].includes(status)) {
    const routeLabel = chain ? `${currency} wallet on ${chain.toUpperCase()}` : `${currency} wallet`;
    return {
      ok: false,
      status: 409,
      body: {
        success: false,
        code: "source_wallet_inactive",
        error: `${routeLabel} is not active.`,
      },
    };
  }
  return { ok: true, bridge_wallet_id: String(data.bridge_wallet_id) };
}

async function resolveRecipientBridgeWallet(input: {
  senderUserId: string;
  recipientEmail?: string | null;
  providedWalletId?: string | null;
  currency: string;
  chain?: string | null;
}): Promise<
  | { ok: true; recipient_user_id: string | null; recipient_email: string | null; bridge_wallet_id: string }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const provided = String(input.providedWalletId || "").trim();
  if (provided) {
    return { ok: true, recipient_user_id: null, recipient_email: null, bridge_wallet_id: provided };
  }

  const email = String(input.recipientEmail || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        code: "recipient_email_required",
        error: "Enter a valid BorderPay recipient email.",
      },
    };
  }

  const { data: recipient, error: recipientError } = await supa
    .from("user_profiles")
    .select("id,email,bridge_customer_id,bridge_kyc_status,kyc_status")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (recipientError) {
    return { ok: false, status: 500, body: { success: false, code: "recipient_lookup_failed", error: "Could not verify this recipient." } };
  }
  if (!recipient?.id || !recipient?.bridge_customer_id) {
    return { ok: false, status: 404, body: { success: false, code: "recipient_not_found", error: "No active BorderPay recipient was found for this email." } };
  }
  const status = String(recipient.bridge_kyc_status || recipient.kyc_status || "").toLowerCase();
  if (!["approved", "verified", "active"].includes(status)) {
    return { ok: false, status: 409, body: { success: false, code: "recipient_not_verified", error: "This recipient is not verified for BorderPay wallet transfers yet." } };
  }

  const currency = String(input.currency || "").trim().toUpperCase();
  const chain = String(input.chain || "").trim().toLowerCase();
  let walletQuery = supa
    .from("bridge_wallets")
    .select("bridge_wallet_id,status")
    .eq("bridge_customer_id", recipient.bridge_customer_id)
    .ilike("currency", currency)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (chain) walletQuery = walletQuery.ilike("chain", chain);
  const { data: wallet, error: walletError } = await walletQuery.maybeSingle();
  if (walletError) {
    return { ok: false, status: 500, body: { success: false, code: "recipient_wallet_lookup_failed", error: "Could not verify the recipient wallet." } };
  }
  if (!wallet?.bridge_wallet_id) {
    return { ok: false, status: 409, body: { success: false, code: "recipient_wallet_not_found", error: `${currency} wallet is not available for this recipient.` } };
  }
  const walletStatus = String(wallet.status || "active").toLowerCase();
  if (["inactive", "disabled", "closed", "archived", "blocked", "suspended", "deactivated"].includes(walletStatus)) {
    return { ok: false, status: 409, body: { success: false, code: "recipient_wallet_inactive", error: `${currency} wallet is not active for this recipient.` } };
  }

  return {
    ok: true,
    recipient_user_id: String(recipient.id),
    recipient_email: String(recipient.email || email),
    bridge_wallet_id: String(wallet.bridge_wallet_id),
  };
}

const SUPPORTED_FX_PAIRS = new Set([
  "USD_BRL", "BRL_USD",
  "USD_COP", "COP_USD",
  "USD_EUR", "EUR_USD",
  "USD_GBP", "GBP_USD",
  "USD_MXN", "MXN_USD",
  "USD_USDT", "USDT_USD",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

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
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  fxLog("request_received", { user_id: user.id, method: req.method });

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  if (!body?.source?.amount || !body?.source?.currency || !body?.destination?.currency) {
    return json({ success: false, error: "source.amount, source.currency, destination.currency required" }, 400);
  }
  const amount = parsePositiveAmount(body?.source?.amount);
  if (!amount) {
    return json({ success: false, error: "source.amount must be a positive decimal number (up to 12 dp, no exponent)" }, 400);
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
    if (!SUPPORTED_FX_PAIRS.has(`${srcCcy}_${dstCcy}`)) {
      return json({
        success: false,
        code: "unsupported_pair",
        error: `Unsupported conversion pair ${srcCcy}/${dstCcy}`,
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
  if (isBridgeBlocked(profile?.country)) {
    return json(bridgeCountryBlockResponse(profile!.country!), 403);
  }
  logControlledBridgeTraffic("bridge-transfer", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    return json({ success: false, error: "Complete account setup before sending transfers", code: "no_customer" }, 409);
  }
  if (profile.verification_status !== "approved") {
    return json({ success: false, error: "KYC not approved yet", code: "kyc_not_approved" }, 409);
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

  // Crypto payout guard (BridgePayoutValidator):
  //   - only USDC/base and USDT/tron are allowed
  //   - developer fee = 1.00 + 0.25% of requested destination amount
  //   - source amount is grossed up so post-fee destination amount matches request
  //   - minimum check is post-fee (dust prevention)
  // Non-crypto rails keep their existing behavior.
  const isCryptoPayout = isCryptoToCryptoTransfer(body);
  let enforcedCryptoPayout:
    | {
        source_payment_rail: "bridge_wallet";
        destination_payment_rail: "base" | "tron";
        chain: "BASE" | "TRON";
        currency: "USDC" | "USDT";
        requested_destination_amount: string;
        gross_amount: string;
        developer_fee: string;
        net_destination_amount: string;
        gross_minimum: string;
        net_minimum: string;
      }
    | null = null;

  if (isCryptoPayout) {
    const validation = validateBridgePayout(body);
    if (!validation.ok) return json(validation.body, validation.status);
    enforcedCryptoPayout = validation.enforced;
  }

  const sourceRail = body.source.payment_rail || "stablecoin";
  const requestedDestinationRail = String(body.destination.payment_rail || "").toLowerCase();
  const isWalletToWallet = String(sourceRail || "").toLowerCase() === "bridge_wallet" && requestedDestinationRail === "bridge_wallet";
  const transferAmount = enforcedCryptoPayout?.gross_amount ?? amount.raw;
  const transferSourceCurrency = enforcedCryptoPayout?.currency ?? body.source.currency;
  const transferDestinationCurrency = enforcedCryptoPayout?.currency ?? body.destination.currency;
  const transferChain = enforcedCryptoPayout?.chain ?? body.source.chain ?? body.destination.chain;
  const transferSourceRail = enforcedCryptoPayout?.source_payment_rail ?? sourceRail;
  const transferDestinationRail = enforcedCryptoPayout?.destination_payment_rail ?? body.destination.payment_rail;
  if (isWalletToWallet && String(transferSourceCurrency).toUpperCase() !== String(transferDestinationCurrency).toUpperCase()) {
    return json({
      success: false,
      code: "unsupported_p2p_pair",
      error: "BorderPay-to-BorderPay transfers currently require the same wallet currency.",
    }, 400);
  }
  const sourceWalletResolution = transferSourceRail === "bridge_wallet"
    ? await resolveSourceBridgeWalletId({
        bridgeCustomerId: profile.bridge_customer_id,
        currency: transferSourceCurrency,
        chain: transferChain,
        providedWalletId: body.source.bridge_wallet_id,
      })
    : null;
  if (sourceWalletResolution && !sourceWalletResolution.ok) {
    return json(sourceWalletResolution.body, sourceWalletResolution.status);
  }
  const recipientWalletResolution = isWalletToWallet
    ? await resolveRecipientBridgeWallet({
        senderUserId: user.id,
        recipientEmail: body.destination.recipient_email,
        providedWalletId: body.destination.bridge_wallet_id,
        currency: transferDestinationCurrency,
        chain: transferChain,
      })
    : null;
  if (recipientWalletResolution && !recipientWalletResolution.ok) {
    return json(recipientWalletResolution.body, recipientWalletResolution.status);
  }

  try {
    fxLog("bridge_request_sent", {
      user_id: user.id,
      idempotency_key: idem,
      source_payment_rail: transferSourceRail,
      destination_payment_rail: transferDestinationRail ?? null,
      amount: transferAmount,
      currency: transferSourceCurrency,
      ...(enforcedCryptoPayout
        ? {
            payout_policy: "bridge_payout_validator_v1",
            developer_fee: enforcedCryptoPayout.developer_fee,
            requested_destination_amount: enforcedCryptoPayout.requested_destination_amount,
            net_destination_amount: enforcedCryptoPayout.net_destination_amount,
          }
        : isWalletToWallet
        ? {
            payout_policy: "borderpay_wallet_to_wallet_v1",
            recipient_user_id: recipientWalletResolution?.ok ? recipientWalletResolution.recipient_user_id : null,
          }
        : {}),
    });
    const result = await bridgeProvider.createTransfer({
      on_behalf_of: profile.bridge_customer_id,
      source: {
        customer_id:  profile.bridge_customer_id,
        payment_rail: transferSourceRail,
        currency:     transferSourceCurrency,
        chain:        transferChain,
        from_address: body.source.from_address,
        bridge_wallet_id: sourceWalletResolution?.ok ? sourceWalletResolution.bridge_wallet_id : body.source.bridge_wallet_id,
        external_account_id: body.source.external_account_id,
        amount:       transferAmount,
      },
      destination: {
        ...body.destination,
        payment_rail: transferDestinationRail,
        currency: transferDestinationCurrency,
        bridge_wallet_id: recipientWalletResolution?.ok ? recipientWalletResolution.bridge_wallet_id : body.destination.bridge_wallet_id,
        ...(transferChain ? { chain: transferChain } : {}),
      },
      developer_fee: isCryptoPayout
        ? { flat_amount: enforcedCryptoPayout!.developer_fee }
        : undefined,
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
      p_amount:             transferAmount,
      p_currency:           transferSourceCurrency,
      p_status:             mapped.transactionStatus,
      p_metadata:           {
        idempotency_key: idem,
        transaction_type: isWalletToWallet ? "p2p_transfer" : "fx_conversion",
        flow: isWalletToWallet ? "wallet_to_wallet" : "stablecoin_sandwich",
        payout_validator: enforcedCryptoPayout ? "bridge_payout_validator_v1" : null,
        recipient_user_id: recipientWalletResolution?.ok ? recipientWalletResolution.recipient_user_id : null,
        recipient_email: recipientWalletResolution?.ok ? recipientWalletResolution.recipient_email : null,
        developer_fee: enforcedCryptoPayout?.developer_fee ?? null,
        requested_destination_amount: enforcedCryptoPayout?.requested_destination_amount ?? null,
        net_destination_amount: enforcedCryptoPayout?.net_destination_amount ?? null,
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
        error:   `Transfer accepted by provider (${result.transfer_id}) but local persistence failed: ${upsertErr.message}`,
        bridge_transfer_id: result.transfer_id,
      }, 500);
    }
    await insertTransferNotification({
      userId: user.id,
      transferId: result.transfer_id,
      amount: transferAmount,
      currency: transferSourceCurrency,
      state: mapped.transactionStatus,
    });
    if (recipientWalletResolution?.ok && recipientWalletResolution.recipient_user_id) {
      await insertRecipientTransferNotification({
        recipientUserId: recipientWalletResolution.recipient_user_id,
        transferId: result.transfer_id,
        amount: transferAmount,
        currency: transferDestinationCurrency,
        senderEmail: user.email ?? null,
        state: mapped.transactionStatus,
      });
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
    const providerError = e instanceof BridgeProviderError ? e : null;
    const providerStatus = providerError?.status ?? 502;
    const providerMessage = providerError?.bridge_error || providerError?.message || "Bridge transfer could not be created.";
    const clientStatus = providerStatus >= 400 && providerStatus < 500 ? 400 : 502;
    const clientCode =
      providerStatus === 400 ? "bridge_transfer_rejected"
      : providerStatus === 409 ? "bridge_transfer_conflict"
      : "bridge_transfer_failed";
    fxLog("bridge_request_failed", {
      user_id: user.id,
      idempotency_key: idem,
      error: (e as Error).message,
      provider_status: providerStatus,
      provider_request_id: providerError?.request_id ?? null,
      bridge_code: providerError?.bridge_code ?? null,
      bridge_error: providerError?.bridge_error ?? null,
    });
    return json({
      success: false,
      code: clientCode,
      error: providerMessage,
      provider_status: providerStatus,
      provider_request_id: providerError?.request_id ?? null,
      bridge_code: providerError?.bridge_code ?? null,
      bridge_error: providerError?.bridge_error ?? null,
    }, clientStatus);
  }
});
