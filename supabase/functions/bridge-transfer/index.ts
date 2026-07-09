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
//   Any developer_fee in the body is ignored.
//
// Feature-flag gate (P0.2):
//
//   Bridge Wallet crypto payout is considered NOT LIVE until a sandbox evidence
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
import type { BridgeCurrencySymbol } from "../_shared/providers/types.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";
import {
  isCryptoToCryptoTransfer,
  validateBridgePayout,
} from "../_shared/bridge-payout-validator.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";

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

function redactPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const clone = JSON.parse(JSON.stringify(value));
  const redactKeys = new Set(["authorization", "api-key", "apikey", "idempotency-key"]);
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
      if (redactKeys.has(key.toLowerCase())) {
        (node as Record<string, unknown>)[key] = "[redacted]";
      } else {
        walk(val);
      }
    }
  };
  walk(clone);
  return clone;
}

function transferTraceFields(body: any): Record<string, unknown> {
  const source = body?.source ?? {};
  const destination = body?.destination ?? {};
  return {
    source_payment_rail: String(source?.payment_rail ?? "bridge_wallet"),
    destination_payment_rail: destination?.payment_rail ? String(destination.payment_rail) : null,
    asset: String(source?.currency ?? destination?.currency ?? "").toUpperCase() || null,
    network: String(source?.chain ?? destination?.chain ?? destination?.payment_rail ?? "").toLowerCase() || null,
    amount: source?.amount != null ? String(source.amount) : null,
    source_wallet_id: source?.bridge_wallet_id ? String(source.bridge_wallet_id) : null,
    destination_bridge_wallet_id: destination?.bridge_wallet_id ? String(destination.bridge_wallet_id) : null,
    destination_external_account_id: destination?.external_account_id ? String(destination.external_account_id) : null,
    destination_address: (destination?.to_address || destination?.address) ? String(destination.to_address || destination.address) : null,
  };
}

async function traceTransfer(stage: string, input: {
  userId?: string | null;
  bridgeCustomerId?: string | null;
  idempotencyKey?: string | null;
  body?: any;
  requestPayload?: unknown;
  responsePayload?: unknown;
  transferId?: string | null;
  httpStatus?: number | null;
  bridgeRequestId?: string | null;
  bridgeErrorCode?: string | null;
  bridgeErrorMessage?: string | null;
  providerStatus?: string | null;
  notes?: string | null;
  executionTimeMs?: number | null;
}) {
  try {
    await supa.from("bridge_transfer_traces").insert({
      correlation_id: input.idempotencyKey ?? null,
      user_id: input.userId ?? null,
      bridge_customer_id: input.bridgeCustomerId ?? null,
      customer_id: input.bridgeCustomerId ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      endpoint: "bridge-transfer",
      method: "POST",
      ...transferTraceFields(input.body ?? {}),
      bridge_request_id: input.bridgeRequestId ?? null,
      http_status: input.httpStatus ?? null,
      bridge_error_code: input.bridgeErrorCode ?? null,
      bridge_error_message: input.bridgeErrorMessage ?? null,
      request_payload: redactPayload(input.requestPayload ?? input.body ?? null),
      response_payload: redactPayload(input.responsePayload ?? null),
      transfer_id: input.transferId ?? null,
      stage,
      notes: input.notes ?? null,
      provider_status: input.providerStatus ?? null,
      execution_time_ms: input.executionTimeMs ?? null,
    });
  } catch (e) {
    fxLog("trace_insert_failed", { stage, error: (e as Error).message });
  }
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

async function emailTransferBestEffort(input: {
  userId: string;
  accountType: "individual" | "business";
  email?: string | null;
  direction: "credit" | "debit";
  amount: string;
  currency: string;
  transferId: string;
  providerState: string;
  description: string;
}) {
  try {
    if (!SEND_EMAIL_TOKEN || !input.email) return;
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    let template = "individual.transaction_notification";
    let props: Record<string, unknown> = {
      full_name: null,
      direction: input.direction,
      amount,
      currency: input.currency,
      reference: input.transferId,
      description: input.description,
      occurred_at: new Date().toISOString(),
    };

    if (input.accountType === "business") {
      const { data: biz } = await supa
        .from("business_profiles")
        .select("company_name")
        .eq("user_id", input.userId)
        .maybeSingle();
      template = "business.transaction_notification";
      props = {
        company_name: biz?.company_name ?? "your business",
        direction: input.direction,
        amount,
        currency: input.currency,
        reference: input.transferId,
        description: input.description,
        occurred_at: new Date().toISOString(),
      };
    } else {
      const { data: prof } = await supa
        .from("user_profiles")
        .select("full_name")
        .eq("id", input.userId)
        .maybeSingle();
      props.full_name = prof?.full_name ?? null;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
      },
      body: JSON.stringify({
        template,
        to: input.email,
        user_id: input.userId,
        idempotency_key: `wh:transfer:${input.userId}:${input.transferId}:${input.providerState}`,
        props,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      fxLog("transfer_email_failed", {
        user_id: input.userId,
        transfer_id: input.transferId,
        status: res.status,
        error: text.slice(0, 240),
      });
    }
  } catch (e) {
    fxLog("transfer_email_failed", {
      user_id: input.userId,
      transfer_id: input.transferId,
      error: (e as Error).message,
    });
  }
}

const supa = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
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
  userId: string;
  currency: string;
  chain?: string | null;
  providedWalletId?: string | null;
}): Promise<{ ok: true; bridge_wallet_id: string } | { ok: false; status: number; body: Record<string, unknown> }> {
  const provided = String(input.providedWalletId || "").trim();

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
    .or(`user_id.eq.${input.userId},business_user_id.eq.${input.userId}`)
    .ilike("currency", currency)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (provided) query = query.eq("bridge_wallet_id", provided);
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

async function syncBridgeWalletsForTransfer(input: {
  userId: string;
  accountType: "individual" | "business";
  bridgeCustomerId: string;
}): Promise<void> {
  try {
    const wallets = await bridgeProvider.listWallets(input.bridgeCustomerId);
    for (const wallet of wallets) {
      if (!wallet.wallet_id) continue;
      const currency = String(wallet.currency || "").trim().toUpperCase();
      const chain = String(wallet.chain || "").trim().toLowerCase();
      if (!currency || !chain) continue;
      await supa.from("bridge_wallets").upsert({
        user_id: input.accountType === "business" ? null : input.userId,
        business_user_id: input.accountType === "business" ? input.userId : null,
        bridge_customer_id: input.bridgeCustomerId,
        bridge_wallet_id: wallet.wallet_id,
        currency,
        chain,
        address: String(wallet.address || ""),
        status: "active",
        updated_at: new Date().toISOString(),
      }, { onConflict: "bridge_wallet_id" });
    }
  } catch (e) {
    fxLog("wallet_sync_failed", {
      user_id: input.userId,
      error: (e as Error).message,
    });
  }
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

  const auth  = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
  const user = userInfo?.user;
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  fxLog("request_received", { user_id: user.id, method: req.method });

  let body: any;
  try { body = await req.json(); } catch {
    await traceTransfer("invalid_json", { userId: user.id, httpStatus: 400, notes: "Invalid JSON" });
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  await traceTransfer("request_received", {
    userId: user.id,
    body,
    requestPayload: body,
    httpStatus: 202,
  });

  // Hard server gate. Fail closed before any Bridge call.
  if (!transfersEnabled()) {
    await traceTransfer("transfer_not_enabled", {
      userId: user.id,
      body,
      requestPayload: body,
      httpStatus: 503,
      notes: "BRIDGE_TRANSFERS_ENABLED is not true",
    });
    return json({
      success: false,
      code:    "transfer_not_enabled",
      error:   "Money movement is not enabled in this environment. Awaiting sandbox evidence sign-off.",
    }, 503);
  }
  if (!body?.source?.amount || !body?.source?.currency || !body?.destination?.currency) {
    await traceTransfer("validation_failed", {
      userId: user.id,
      body,
      requestPayload: body,
      httpStatus: 400,
      notes: "source.amount, source.currency, destination.currency required",
    });
    return json({ success: false, error: "source.amount, source.currency, destination.currency required" }, 400);
  }
  const amount = parsePositiveAmount(body?.source?.amount);
  if (!amount) {
    await traceTransfer("validation_failed", {
      userId: user.id,
      body,
      requestPayload: body,
      httpStatus: 400,
      notes: "source.amount must be a positive decimal number",
    });
    return json({ success: false, error: "source.amount must be a positive decimal number (up to 12 dp, no exponent)" }, 400);
  }
  if (!isValidIdempotencyKey(body?.idempotency_key)) {
    await traceTransfer("validation_failed", {
      userId: user.id,
      body,
      requestPayload: body,
      httpStatus: 400,
      notes: "idempotency_key_required",
    });
    return json({
      success: false,
      code:    "idempotency_key_required",
      error:   "A client-provided idempotency_key (8-128 printable ASCII chars) is required for transfers.",
    }, 400);
  }
  // Canonicalise: include user.id so two users can't collide on the same key.
  const clientKey = body.idempotency_key as string;
  const idem      = `borderpay:transfer:${user.id}:${clientKey}`;

  // FX policy gate (wallet->wallet conversion only): only allow documented
  // supported pairs for conversion-style routes. Other transfer rails remain
  // unaffected (send/payout/onramp/offramp).
  const srcRail = String(body?.source?.payment_rail || "").toLowerCase();
  const dstRail = String(body?.destination?.payment_rail || "").toLowerCase();
  const srcCcy = String(body?.source?.currency || "").toUpperCase();
  const dstCcy = String(body?.destination?.currency || "").toUpperCase();
  if (srcRail === "bridge_wallet" && dstRail === "bridge_wallet" && srcCcy !== dstCcy) {
    if (!SUPPORTED_FX_PAIRS.has(`${srcCcy}_${dstCcy}`)) {
      await traceTransfer("validation_failed", {
        userId: user.id,
        idempotencyKey: idem,
        body,
        requestPayload: body,
        httpStatus: 400,
        notes: `Unsupported conversion pair ${srcCcy}/${dstCcy}`,
      });
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
    source_payment_rail: body?.source?.payment_rail ?? "bridge_wallet",
    destination_payment_rail: body?.destination?.payment_rail ?? null,
  });

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    await traceTransfer("identity_failed", {
      userId: user.id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      httpStatus: 409,
      responsePayload: identity.failure,
      notes: String(identity.failure?.code ?? "identity_invariant_failed"),
    });
    return json({ success: false, ...identity.failure }, 409);
  }
  const profile = identity.context;
  if (isBridgeBlocked(profile?.country)) {
    const blocked = bridgeCountryBlockResponse(profile!.country!);
    await traceTransfer("country_blocked", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      responsePayload: blocked,
      httpStatus: 403,
      notes: `country=${profile?.country ?? ""}`,
    });
    return json(blocked, 403);
  }
  logControlledBridgeTraffic("bridge-transfer", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    await traceTransfer("identity_failed", {
      userId: user.id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      httpStatus: 409,
      notes: "no_customer",
    });
    return json({ success: false, error: "Complete account setup before sending transfers", code: "no_customer" }, 409);
  }
  if (profile.verification_status !== "approved") {
    await traceTransfer("identity_failed", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      httpStatus: 409,
      notes: `verification_status=${profile.verification_status}`,
    });
    return json({ success: false, error: "KYC not approved yet", code: "kyc_not_approved" }, 409);
  }

  // Corridor note (#B1): African corridors settle through Bridge Wallet crypto
  // payout rails (USDT/USDC to a user-supplied address on a supported network).
  // Destination is the blockchain rail + address, no local-bank aggregator. International
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
      await traceTransfer("idempotent_replay", {
        userId: user.id,
        bridgeCustomerId: profile.bridge_customer_id,
        idempotencyKey: idem,
        body,
        requestPayload: body,
        transferId: existing.bridge_transfer_id,
        httpStatus: 200,
        providerStatus: existing.status,
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

  // Bridge Wallet crypto payout guard (BridgePayoutValidator):
  //   - only USDC/base and USDT/tron are allowed
  //   - developer fee = 1.00 flat
  //   - source amount is passed to Bridge unchanged
  // Non-crypto rails keep their existing behavior.
  const isCryptoPayout = isCryptoToCryptoTransfer(body);
  let enforcedCryptoPayout:
    | {
        source_payment_rail: "bridge_wallet";
        destination_payment_rail: "base" | "tron";
        chain: "BASE" | "TRON";
        currency: "USDC" | "USDT";
        amount: string;
        developer_fee: string;
        minimum: string;
      }
    | null = null;

  if (isCryptoPayout) {
    const validation = validateBridgePayout(body);
    if (!validation.ok) {
      await traceTransfer("validation_failed", {
        userId: user.id,
        bridgeCustomerId: profile.bridge_customer_id,
        idempotencyKey: idem,
        body,
        requestPayload: body,
        responsePayload: validation.body,
        httpStatus: validation.status,
        notes: String(validation.body?.code ?? "crypto_payout_validation_failed"),
      });
      return json(validation.body, validation.status);
    }
    enforcedCryptoPayout = validation.enforced;
  }

  const sourceRail = body.source.payment_rail || "bridge_wallet";
  const requestedDestinationRail = String(body.destination.payment_rail || "").toLowerCase();
  const isWalletToWallet = String(sourceRail || "").toLowerCase() === "bridge_wallet" && requestedDestinationRail === "bridge_wallet";
  const transferAmount = enforcedCryptoPayout?.amount ?? amount.raw;
  const transferSourceCurrency = String(enforcedCryptoPayout?.currency ?? body.source.currency).toLowerCase() as BridgeCurrencySymbol;
  const transferDestinationCurrency = String(enforcedCryptoPayout?.currency ?? body.destination.currency).toLowerCase() as BridgeCurrencySymbol;
  const transferChain = enforcedCryptoPayout?.chain ?? body.source.chain ?? body.destination.chain;
  const transferSourceRail = enforcedCryptoPayout?.source_payment_rail ?? sourceRail;
  const transferDestinationRail = enforcedCryptoPayout?.destination_payment_rail ?? body.destination.payment_rail;
  if (isWalletToWallet && String(transferSourceCurrency).toUpperCase() !== String(transferDestinationCurrency).toUpperCase()) {
    await traceTransfer("validation_failed", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      httpStatus: 400,
      notes: "unsupported_p2p_pair",
    });
    return json({
      success: false,
      code: "unsupported_p2p_pair",
      error: "BorderPay-to-BorderPay transfers currently require the same wallet currency.",
    }, 400);
  }
  if (String(transferSourceRail || "").toLowerCase() === "bridge_wallet") {
    await syncBridgeWalletsForTransfer({
      userId: user.id,
      accountType: profile.account_type,
      bridgeCustomerId: profile.bridge_customer_id,
    });
  }
  const sourceWalletResolution = transferSourceRail === "bridge_wallet"
    ? await resolveSourceBridgeWalletId({
        bridgeCustomerId: profile.bridge_customer_id,
        userId: user.id,
        currency: transferSourceCurrency,
        chain: transferChain,
        providedWalletId: body.source.bridge_wallet_id,
      })
    : null;
  if (sourceWalletResolution && !sourceWalletResolution.ok) {
    await traceTransfer("wallet_lookup_failed", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      responsePayload: sourceWalletResolution.body,
      httpStatus: sourceWalletResolution.status,
      notes: String(sourceWalletResolution.body?.code ?? "source_wallet_lookup_failed"),
    });
    return json(sourceWalletResolution.body, sourceWalletResolution.status);
  }
  if (sourceWalletResolution?.ok) {
    await traceTransfer("wallet_lookup_completed", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      httpStatus: 200,
      notes: `source_wallet_id=${sourceWalletResolution.bridge_wallet_id}`,
    });
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
    await traceTransfer("recipient_wallet_lookup_failed", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: body,
      responsePayload: recipientWalletResolution.body,
      httpStatus: recipientWalletResolution.status,
      notes: String(recipientWalletResolution.body?.code ?? "recipient_wallet_lookup_failed"),
    });
    return json(recipientWalletResolution.body, recipientWalletResolution.status);
  }

  try {
    const providerRequest = {
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
      idempotency_key: idem,
    };
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
            bridge_amount: enforcedCryptoPayout.amount,
          }
        : isWalletToWallet
        ? {
            payout_policy: "borderpay_wallet_to_wallet_v1",
            recipient_user_id: recipientWalletResolution?.ok ? recipientWalletResolution.recipient_user_id : null,
          }
        : {}),
    });
    await traceTransfer("bridge_payload_built", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: providerRequest,
      httpStatus: 202,
    });
    const startedAt = Date.now();
    const result = await bridgeProvider.createTransfer(providerRequest);

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
    await traceTransfer("bridge_transfer_success", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: providerRequest,
      responsePayload: result.raw,
      transferId: result.transfer_id,
      httpStatus: 200,
      providerStatus: mapped.providerState,
      executionTimeMs: Date.now() - startedAt,
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
        flow: isWalletToWallet ? "wallet_to_wallet" : isCryptoPayout ? "bridge_wallet_crypto_payout" : "bridge_transfer",
        payout_validator: enforcedCryptoPayout ? "bridge_payout_validator_v1" : null,
        recipient_user_id: recipientWalletResolution?.ok ? recipientWalletResolution.recipient_user_id : null,
        recipient_email: recipientWalletResolution?.ok ? recipientWalletResolution.recipient_email : null,
        developer_fee: enforcedCryptoPayout?.developer_fee ?? null,
        bridge_amount: enforcedCryptoPayout?.amount ?? null,
        provider_state:  mapped.providerState,
        provider_state_recognized: mapped.recognized,
        raw: result.raw,
      },
      p_description:        null,
    });
    if (upsertErr) {
      // Bridge already accepted the transfer — surface the persistence
      // failure but with the transfer_id so the client can be reconciled.
      await traceTransfer("transaction_upsert_failed", {
        userId: user.id,
        bridgeCustomerId: profile.bridge_customer_id,
        idempotencyKey: idem,
        body,
        requestPayload: providerRequest,
        responsePayload: result.raw,
        transferId: result.transfer_id,
        httpStatus: 500,
        providerStatus: mapped.providerState,
        notes: upsertErr.message,
      });
      return json({
        success: false,
        code:    "persistence_failed",
        error:   `Transfer accepted by provider (${result.transfer_id}) but local persistence failed: ${upsertErr.message}`,
        bridge_transfer_id: result.transfer_id,
      }, 500);
    }
    await traceTransfer("transaction_upserted", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: providerRequest,
      responsePayload: result.raw,
      transferId: result.transfer_id,
      httpStatus: 200,
      providerStatus: mapped.providerState,
    });
    await insertTransferNotification({
      userId: user.id,
      transferId: result.transfer_id,
      amount: transferAmount,
      currency: transferSourceCurrency,
      state: mapped.transactionStatus,
    });
    await traceTransfer("notification_upserted", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      transferId: result.transfer_id,
      httpStatus: 200,
      providerStatus: mapped.providerState,
    });
    await emailTransferBestEffort({
      userId: user.id,
      accountType: profile.account_type,
      email: user.email ?? null,
      direction: "debit",
      amount: transferAmount,
      currency: transferSourceCurrency,
      transferId: result.transfer_id,
      providerState: mapped.providerState,
      description: isWalletToWallet ? "BorderPay wallet transfer" : "Bridge wallet payout",
    });
    await traceTransfer("email_dispatched", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      transferId: result.transfer_id,
      httpStatus: 200,
      providerStatus: mapped.providerState,
      notes: "sender email best-effort dispatched",
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
      const { data: recipientProfile } = await supa
        .from("user_profiles")
        .select("email, account_type")
        .eq("id", recipientWalletResolution.recipient_user_id)
        .maybeSingle();
      await emailTransferBestEffort({
        userId: recipientWalletResolution.recipient_user_id,
        accountType: recipientProfile?.account_type === "business" ? "business" : "individual",
        email: recipientProfile?.email ?? null,
        direction: "credit",
        amount: transferAmount,
        currency: transferDestinationCurrency,
        transferId: result.transfer_id,
        providerState: mapped.providerState,
        description: user.email ? `BorderPay wallet transfer from ${user.email}` : "BorderPay wallet transfer",
      });
      await traceTransfer("recipient_email_dispatched", {
        userId: user.id,
        bridgeCustomerId: profile.bridge_customer_id,
        idempotencyKey: idem,
        body,
        transferId: result.transfer_id,
        httpStatus: 200,
        providerStatus: mapped.providerState,
        notes: `recipient_user_id=${recipientWalletResolution.recipient_user_id}`,
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
    await traceTransfer("bridge_transfer_failed", {
      userId: user.id,
      bridgeCustomerId: profile.bridge_customer_id,
      idempotencyKey: idem,
      body,
      requestPayload: {
        source: {
          payment_rail: transferSourceRail,
          currency: transferSourceCurrency,
          chain: transferChain,
          bridge_wallet_id: sourceWalletResolution?.ok ? sourceWalletResolution.bridge_wallet_id : body.source.bridge_wallet_id,
          amount: transferAmount,
        },
        destination: {
          ...body.destination,
          payment_rail: transferDestinationRail,
          currency: transferDestinationCurrency,
          bridge_wallet_id: recipientWalletResolution?.ok ? recipientWalletResolution.bridge_wallet_id : body.destination.bridge_wallet_id,
          ...(transferChain ? { chain: transferChain } : {}),
        },
      },
      responsePayload: providerError
        ? {
            status: providerError.status ?? null,
            request_id: providerError.request_id ?? null,
            bridge_code: providerError.bridge_code ?? null,
            bridge_error: providerError.bridge_error ?? null,
            raw_text: providerError.raw_text ?? null,
          }
        : { error: (e as Error).message },
      httpStatus: providerStatus,
      bridgeRequestId: providerError?.request_id ?? null,
      bridgeErrorCode: providerError?.bridge_code ?? null,
      bridgeErrorMessage: providerError?.bridge_error ?? (e as Error).message,
      notes: clientCode,
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
