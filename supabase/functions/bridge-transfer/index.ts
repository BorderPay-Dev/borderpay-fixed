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
//   (crypto payout flat fee / external-account fiat off-ramp percent fee).
//   Any developer_fee in the body is ignored.
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
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { isBridgeBlocked, bridgeCountryBlockResponse, logControlledBridgeTraffic } from "../_shared/providers/bridge-country-policy.ts";
import { requireMinimumWalletBalance } from "../_shared/funding-gate.ts";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { mapBridgeTransferState } from "../_shared/bridge-transfer-state.ts";
import {
  isCryptoToCryptoTransfer,
  validateBridgePayout,
} from "../_shared/bridge-payout-validator.ts";
import { BRIDGE_DEVELOPER_FEE_PERCENT } from "../_shared/fees/schedule.ts";
import type { BridgePaymentRail } from "../_shared/providers/types.ts";
import { getFinancialAccessBlock } from "../_shared/account-access.ts";
import { consumeScaAuthorization, scaPayloadHash } from "../_shared/sca.ts";
import { transferInitiation, withdrawalInitiationChannel, type WalletInitiationRequirement } from "../_shared/bridge-transfer-initiation.ts";
import { resolveBridgeScaScope, resolveBridgeWalletAssetScope } from "../_shared/bridge-sca-scope.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const CURRENCY_SCALE: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  USDC: 6,
  USDT: 6,
};

function fxLog(stage: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    service: "bridge-transfer",
    stage,
    at: new Date().toISOString(),
    ...detail,
  }));
}

function normalizeBridgeEndpointType(value: unknown): "virtual_account" | "wallet" | "external_bank" | "external_wallet" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "bridge_wallet" || raw === "wallet") return "wallet";
  if (raw === "virtual_account" || raw === "virtual_account_bank" || raw === "payment_route") return "virtual_account";
  if (raw === "external_wallet" || raw === "crypto" || raw === "blockchain" || raw === "base" || raw === "tron" || raw === "ethereum") return "external_wallet";
  if (raw === "external_bank" || raw === "ach" || raw === "wire" || raw === "sepa" || raw === "faster_payments") return "external_bank";
  return "external_bank";
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

function fixedDeveloperFeeForPercent(amountRaw: string, percent: number): string {
  const amountCents = Math.round(Number(amountRaw) * 100);
  const feeCents = Math.round((amountCents * percent) / 100);
  return (feeCents / 100).toFixed(2);
}

function decimalToMinor(raw: string, currency: string): bigint | null {
  const value = String(raw || "").trim();
  if (!/^\d+(\.\d{1,12})?$/.test(value)) return null;
  const scale = CURRENCY_SCALE[String(currency || "").toUpperCase()] ?? 2;
  const [wholeRaw, fracRaw = ""] = value.split(".");
  const whole = BigInt(wholeRaw || "0");
  const fracPadded = (fracRaw + "0".repeat(scale)).slice(0, scale);
  return whole * (10n ** BigInt(scale)) + BigInt(fracPadded || "0");
}

async function spendableWalletBalanceMinor(userId: string, currency: string): Promise<bigint> {
  const { data, error } = await supa
    .from("bridge_balance_ledger")
    .select("amount_minor,direction")
    .or(`user_id.eq.${userId},business_user_id.eq.${userId}`)
    .eq("entity_type", "wallet")
    .eq("currency", String(currency || "").toUpperCase());
  if (error) throw new Error(`balance_check_failed:${error.message}`);
  return (data || []).reduce((sum: bigint, row: Record<string, unknown>) => {
    const amount = BigInt(String(row.amount_minor ?? "0"));
    const abs = amount < 0n ? -amount : amount;
    return String(row.direction || "").toLowerCase() === "debit" ? sum - abs : sum + abs;
  }, 0n);
}

async function recordTransferProviderAlert(input: {
  user_id: string;
  account_type?: string | null;
  source_currency?: string | null;
  destination_currency?: string | null;
  source_payment_rail?: string | null;
  destination_payment_rail?: string | null;
  idempotency_key?: string | null;
  error: unknown;
}) {
  const err = input.error as Error & {
    status?: number;
    request_id?: string;
    bridge_code?: string;
    bridge_error?: string;
    raw_text?: string;
  };
  const providerStatus = Number(err?.status || 0) || null;
  const providerCode = typeof err?.bridge_code === "string" ? err.bridge_code : null;
  const providerRequestId = typeof err?.request_id === "string" ? err.request_id : null;
  const providerMessage = typeof err?.bridge_error === "string"
    ? err.bridge_error
    : (err?.message || "Transfer provider request failed");

  await supa.from("admin_alerts").insert({
    alert_type: "bridge_transfer_provider_error",
    severity: providerStatus && providerStatus >= 500 ? "critical" : "high",
    user_id: input.user_id,
    message: "Outbound transfer request needs operator review.",
    metadata: {
      service: "bridge-transfer",
      code: "bridge_provider_error",
      provider_status: providerStatus,
      provider_code: providerCode,
      provider_request_id: providerRequestId,
      provider_message: providerMessage,
      raw_text: typeof err?.raw_text === "string" ? err.raw_text.slice(0, 1000) : null,
      account_type: input.account_type ?? null,
      source_currency: input.source_currency ?? null,
      destination_currency: input.destination_currency ?? null,
      source_payment_rail: input.source_payment_rail ?? null,
      destination_payment_rail: input.destination_payment_rail ?? null,
      idempotency_key: input.idempotency_key ?? null,
      occurred_at: new Date().toISOString(),
    },
  });
}

const SUPPORTED_FX_PAIRS = new Set([
  "USD_BRL", "BRL_USD",
  "USD_COP", "COP_USD",
  "USD_EUR", "EUR_USD",
  "USD_GBP", "GBP_USD",
  "USD_MXN", "MXN_USD",
  "USD_USDT", "USDT_USD",
]);

const FIAT_EXTERNAL_ACCOUNT_RAILS = new Set([
  "ach",
  "wire",
  "ach_push",
  "ach_same_day",
  "fednow",
  "sepa",
  "faster_payments",
]);
const FIAT_EXTERNAL_ACCOUNT_DESTINATION_CURRENCIES = new Set(["USD", "EUR", "GBP"]);
const FIAT_EXTERNAL_ACCOUNT_SOURCE_CURRENCIES = new Set(["USDC", "USDT"]);

function isFiatExternalAccountOfframp(body: any): boolean {
  const srcRail = String(body?.source?.payment_rail || "").toLowerCase();
  const dstRail = String(body?.destination?.payment_rail || "").toLowerCase();
  return srcRail === "bridge_wallet"
    && FIAT_EXTERNAL_ACCOUNT_RAILS.has(dstRail)
    && !!String(body?.destination?.external_account_id || "").trim();
}

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
  const accessBlock = await getFinancialAccessBlock(supa, user.id);
  if (accessBlock) return json({ success: false, ...accessBlock }, 423);
  fxLog("request_received", { user_id: user.id, method: req.method });

  let body: any;
  try { body = await req.json(); } catch {
    await recordTransferProviderAlert({
      user_id: user.id,
      error: { status: 400, bridge_code: "invalid_json", bridge_error: "Invalid JSON" },
    });
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  // Bind SCA to the exact client request before validation derives or appends
  // provider-only fields such as destination.to_address. Hashing the mutated
  // object makes a valid PIN + TOTP authorization impossible to consume.
  const scaAuthorizedRequest = structuredClone(body);
  const failAfterAuth = async (payload: Record<string, unknown>, status: number, accountType?: string | null) => {
    try {
      await recordTransferProviderAlert({
        user_id: user.id,
        account_type: accountType ?? null,
        source_currency: body?.source?.currency ?? null,
        destination_currency: body?.destination?.currency ?? null,
        source_payment_rail: body?.source?.payment_rail ?? null,
        destination_payment_rail: body?.destination?.payment_rail ?? null,
        idempotency_key: typeof body?.idempotency_key === "string" ? body.idempotency_key : null,
        error: {
          status,
          bridge_code: String(payload.code || "preflight_failed"),
          bridge_error: String(payload.error || payload.message || "Transfer request failed before provider execution"),
        },
      });
    } catch (alertErr) {
      fxLog("admin_alert_insert_failed", {
        user_id: user.id,
        error: (alertErr as Error).message,
      });
    }
    return json(payload, status);
  };
  if (!body?.source?.amount || !body?.source?.currency || !body?.destination?.currency) {
    return await failAfterAuth({ success: false, code: "missing_required_transfer_fields", error: "source.amount, source.currency, destination.currency required" }, 400);
  }
  const amount = parsePositiveAmount(body?.source?.amount);
  if (!amount) {
    return await failAfterAuth({ success: false, code: "invalid_amount", error: "source.amount must be a positive decimal number (up to 12 dp, no exponent)" }, 400);
  }
  if (!isValidIdempotencyKey(body?.idempotency_key)) {
    return await failAfterAuth({
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
      return await failAfterAuth({
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
    source_payment_rail: body?.source?.payment_rail ?? null,
    destination_payment_rail: body?.destination?.payment_rail ?? null,
  });

  const identity = await loadAndAssertBridgeIdentityInvariant(supa, user.id);
  if (!identity.ok) {
    return await failAfterAuth({ success: false, ...identity.failure }, 409);
  }
  const profile = identity.context;
  if (isBridgeBlocked(profile?.country)) {
    return await failAfterAuth(bridgeCountryBlockResponse(profile!.country!) as Record<string, unknown>, 403, profile.account_type);
  }
  // Account-maintenance billing is not active until the configured billing
  // cycle begins. A legacy overdue flag must never become an
  // independent money-movement authority. Billing restrictions belong to the
  // subscription grace-period workflow, not this provider transfer boundary.
  logControlledBridgeTraffic("bridge-transfer", profile?.country, user.id);
  if (!profile.bridge_customer_id) {
    return await failAfterAuth({ success: false, error: "Complete account setup before sending transfers", code: "no_customer" }, 409, profile.account_type);
  }
  if (profile.verification_status !== "approved") {
    return await failAfterAuth({ success: false, error: "KYC not approved yet", code: "kyc_not_approved" }, 409, profile.account_type);
  }

  // USDT/Tron is a separate non-EEA wallet rail. It is never a VA settlement
  // destination, and EEA or unresolved customer scope must fail closed before
  // any provider-side money movement.
  if (srcCcy === "EURC" || dstCcy === "EURC") {
    const scope = await resolveBridgeWalletAssetScope(supa, user.id);
    if (!scope.allow_eurc_base) return await failAfterAuth({ success: false,
      code: "wallet_asset_not_available", error: "EURC is only available for EEA accounts." }, 403, profile.account_type);
  }
  const requestsUsdt = srcCcy === "USDT" || dstCcy === "USDT"
    || srcRail === "tron" || dstRail === "tron";
  if (requestsUsdt) {
    const walletScope = await resolveBridgeScaScope(supa, user.id);
    const allowUsdtTron = walletScope.status === "not_required"
      && walletScope.reason === "non_eea"
      && Boolean(walletScope.country);
    if (!allowUsdtTron) {
      return await failAfterAuth({
        success: false,
        code: "wallet_asset_not_available",
        error: "USDT on Tron is not available for this account region.",
      }, 403, profile.account_type);
    }
  }

  // Legacy minimum-balance gate retained as a compatibility no-op.
  {
    const isBusiness = profile.account_type === "business";
    const __planGate = await requireMinimumWalletBalance(supa, user.id, {
      isBusiness,
      bridgeCustomerId: profile.bridge_customer_id,
    });
    if (!__planGate.allowed) return await failAfterAuth(__planGate.body as Record<string, unknown>, __planGate.status, profile.account_type);
  }

  // Canonicalise: include user.id so two users can't collide on the same key.
  const clientKey = body.idempotency_key as string;
  const idem      = `borderpay:transfer:${user.id}:${clientKey}`;

  // Bridge wallet payouts use source.payment_rail=bridge_wallet and a
  // destination chain rail (base/tron). Never invent provider rail names.

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
  //   - only USDC/base, EURC/base, and USDT/tron are allowed
  //   - a saved external wallet is required before money moves
  //   - the saved address is sent directly as destination.to_address through
  //     the provider's crypto-to-crypto Transfers API
  //   - liquidation addresses are never created, read, or used by this path
  //   - minimum check prevents dust transfers
  // Non-crypto rails keep their existing behavior.
  const isCryptoPayout = isCryptoToCryptoTransfer(body);
  let enforcedCryptoPayout:
    | {
        source_payment_rail: "bridge_wallet";
        destination_payment_rail: "base" | "tron";
        chain: "BASE" | "TRON";
        currency: "USDC" | "EURC" | "USDT";
        gross_amount: string;
        developer_fee: string;
        bridge_developer_fee: string | null;
        is_cross_token: boolean;
        net_destination_amount: string;
        gross_minimum: string;
        net_minimum: string;
      }
    | null = null;
  let cryptoFinalAddress = "";

  if (isCryptoPayout) {
    const validation = validateBridgePayout(body);
    if (!validation.ok) return await failAfterAuth(validation.body as Record<string, unknown>, validation.status, profile.account_type);
    enforcedCryptoPayout = validation.enforced;
    if (!String(body?.source?.bridge_wallet_id || "").trim()) {
      return await failAfterAuth({
        success: false,
        code: "source_wallet_required",
        error: "The selected wallet is not ready for sending yet. Refresh your wallet and try again.",
      }, 400, profile.account_type);
    }
    const destinationAddress = String(body?.destination?.address || body?.destination?.to_address || "").trim();
    const destinationChain = String(enforcedCryptoPayout.destination_payment_rail || "").toLowerCase();
    const destinationCurrency = enforcedCryptoPayout.currency;
    const requestedExternalWalletId = String(body?.destination?.external_wallet_id || "").trim();
    const { data: savedWallet } = await supa
      .from("external_wallets")
      .select("id, address, asset, chain")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("chain", destinationChain)
      .eq("address", destinationAddress)
      .maybeSingle();
    const savedAsset = String(savedWallet?.asset || "").toUpperCase();
    const compatibleSavedDestination = destinationChain === "base"
      ? savedAsset === "USDC" || savedAsset === "EURC"
      : savedAsset === destinationCurrency;
    if (!savedWallet || !compatibleSavedDestination) {
      return await failAfterAuth({
        success: false,
        code: "saved_external_wallet_required",
        error: "Save this withdrawal wallet before sending.",
      }, 409, profile.account_type);
    }
    const savedWalletId = String(savedWallet?.id || "").trim();
    cryptoFinalAddress = String(savedWallet?.address || destinationAddress).trim();
    if (requestedExternalWalletId && requestedExternalWalletId !== savedWalletId) {
      return await failAfterAuth({
        success: false,
        code: "external_wallet_mismatch",
        error: "Choose the saved wallet again before sending.",
      }, 409, profile.account_type);
    }
    body.destination = {
      ...body.destination,
      address: cryptoFinalAddress,
      to_address: cryptoFinalAddress,
    };
  }

  const isFiatExternalOfframp = isFiatExternalAccountOfframp(body);
  if (isFiatExternalOfframp) {
    const sourceWalletId = String(body?.source?.bridge_wallet_id || "").trim();
    const externalAccountId = String(body?.destination?.external_account_id || "").trim();
    const sourceCurrency = String(body?.source?.currency || "").toUpperCase();
    const destinationCurrency = String(body?.destination?.currency || "").toUpperCase();
    if (!sourceWalletId) {
      return await failAfterAuth({
        success: false,
        code: "source_wallet_required",
        error: "USDC or USDT wallet id is required for fiat external-account payout.",
      }, 400, profile.account_type);
    }
    if (!externalAccountId) {
      return await failAfterAuth({
        success: false,
        code: "external_account_required",
        error: "Bridge external account id is required for fiat payout.",
      }, 400, profile.account_type);
    }
    if (!FIAT_EXTERNAL_ACCOUNT_SOURCE_CURRENCIES.has(sourceCurrency)) {
      return await failAfterAuth({
        success: false,
        code: "unsupported_offramp_source",
        error: "Fiat external-account payouts must source from the user's USDC or USDT wallet.",
      }, 400, profile.account_type);
    }
    if (!FIAT_EXTERNAL_ACCOUNT_DESTINATION_CURRENCIES.has(destinationCurrency)) {
      return await failAfterAuth({
        success: false,
        code: "unsupported_offramp_currency",
        error: "Supported fiat external-account payout currencies are USD, EUR, and GBP.",
      }, 400, profile.account_type);
    }
  }

  const sourceRailRaw = String(body.source.payment_rail || "").trim();
  if (!sourceRailRaw) {
    return await failAfterAuth({
      success: false,
      code: "source_payment_rail_required",
      error: "Source payment rail is required.",
    }, 400, profile.account_type);
  }
  const sourceRail = sourceRailRaw as BridgePaymentRail;
  const transferAmount = enforcedCryptoPayout?.gross_amount ?? amount.raw;
  const transferSourceCurrency = enforcedCryptoPayout?.currency ?? body.source.currency;
  const transferDestinationCurrency = enforcedCryptoPayout?.currency ?? body.destination.currency;
  const normalizedSourceType = normalizeBridgeEndpointType(sourceRail);
  const normalizedDestinationType = normalizeBridgeEndpointType(enforcedCryptoPayout?.destination_payment_rail ?? body.destination.payment_rail);
  const transactionDirection = normalizedSourceType === "wallet" ? "debit" : "credit";
  const transactionType = transactionDirection === "debit" ? "withdrawal" : "deposit";

  if (normalizedSourceType === "wallet") {
    try {
      const requiredMinor = decimalToMinor(String(transferAmount), String(transferSourceCurrency));
      if (requiredMinor === null || requiredMinor <= 0n) {
        return await failAfterAuth({
          success: false,
          code: "invalid_amount",
          error: "Enter a valid amount to send.",
        }, 400, profile.account_type);
      }
      const feeMinor = 0n;
      const totalRequiredMinor = requiredMinor + feeMinor;
      const availableMinor = await spendableWalletBalanceMinor(user.id, String(transferSourceCurrency));
      if (availableMinor < totalRequiredMinor) {
        return await failAfterAuth({
          success: false,
          code: "insufficient_balance",
          error: `Insufficient ${String(transferSourceCurrency).toUpperCase()} balance for this payout.`,
          available_balance_minor: availableMinor.toString(),
          required_balance_minor: totalRequiredMinor.toString(),
        }, 402, profile.account_type);
      }
    } catch (balanceErr) {
      return await failAfterAuth({
        success: false,
        code: "balance_check_unavailable",
        error: "We could not verify your wallet balance right now. Please retry shortly.",
      }, 503, profile.account_type);
    }
  }

  // Inspect the exact source wallet before consuming a one-time authorization.
  // Absence of initiation_required means omit provider initiation, NOT skip
  // BorderPay's mandatory EEA authentication.
  let walletInitiation: WalletInitiationRequirement | null = null;
  let initiationChannel = withdrawalInitiationChannel(req.headers);
  const paymentPayloadHash = await scaPayloadHash("bridge_transfer", scaAuthorizedRequest);
  try {
    if (normalizedSourceType === "wallet") {
      walletInitiation = await bridgeProvider.getWalletInitiationRequirement(
        profile.bridge_customer_id, String(body.source.bridge_wallet_id || ""),
      );
    }
    // Preserve the first initiation context across client retries as well as
    // bridgeFetch's HTTP retries. Never reuse a key for changed payment data.
    const { data: prepared, error: preparedError } = await supa.from("admin_action_audit")
      .select("after_state")
      .eq("actor_id", user.id).eq("request_id", idem)
      .eq("action_type", "bridge_transfer_initiation_prepared")
      .order("timestamp", { ascending: true }).limit(1).maybeSingle();
    if (preparedError) throw new Error("initiation_audit_lookup_failed");
    if (prepared) {
      const prior = prepared.after_state;
      if (prior?.payload_hash !== paymentPayloadHash
        || prior?.wallet_initiation_required !== (walletInitiation?.required ?? false)
        || !["other", "other_mobile_payment"].includes(prior?.channel)) {
        return await failAfterAuth({ success: false, code: "initiation_retry_mismatch",
          error: "This payment's details changed. Refresh and authorize a new payment." }, 409, profile.account_type);
      }
      initiationChannel = prior.channel;
    }
  } catch {
    return await failAfterAuth({ success: false, code: "wallet_initiation_unavailable",
      error: "We could not verify the payment authentication requirements. Nothing was sent. Please retry shortly." }, 503, profile.account_type);
  }

  // For verified EEA custodial-wallet customers, consume a one-time PIN +
  // authenticator authorization bound to this exact transfer request. This is
  // deliberately after replay/validation checks and before the provider call.
  const sca = await consumeScaAuthorization({
    supabase: supa,
    authorizationId: body?.sca_authorization_id,
    userId: user.id,
    operation: "payment",
    resource: "bridge_transfer",
    request: scaAuthorizedRequest,
  });
  if (!sca.ok) return await failAfterAuth(sca.body, sca.status, profile.account_type);

  const scaAttestation = sca.required ? {
    outcome: "sca_used" as const,
    channel: initiationChannel,
    subchannel: "remote" as const,
  } : undefined;
  // No exemption is invented when Bridge requires SCA outside local scope.
  if (walletInitiation?.required && !scaAttestation) {
    return await failAfterAuth({ success: false, code: "bridge_wallet_sca_required",
      error: "This wallet requires strong authentication. Contact support before retrying." }, 403, profile.account_type);
  }
  const initiation = transferInitiation(walletInitiation, scaAttestation);
  const initiationEvidence = {
    payload_hash: paymentPayloadHash,
    source_wallet_id: walletInitiation?.wallet_id ?? null,
    wallet_initiation_required: walletInitiation?.required ?? false,
    channel: initiationChannel,
    initiation,
    sca_required: sca.required,
    sca_authorization_id: sca.required ? String(body.sca_authorization_id) : null,
  };
  const { error: initiationAuditError } = await supa.from("admin_action_audit").insert({
    actor_id: user.id, role: "system", action_type: "bridge_transfer_initiation_prepared",
    target_resource: "bridge_transfer", request_id: idem, after_state: initiationEvidence,
  });
  if (initiationAuditError) {
    return await failAfterAuth({ success: false, code: "sca_evidence_unavailable",
      error: "Payment authentication could not be recorded. Nothing was sent. Please authorize again." }, 503, profile.account_type);
  }

  try {
    fxLog("bridge_request_sent", {
      user_id: user.id,
      idempotency_key: idem,
      source_payment_rail: sourceRail,
      destination_payment_rail: body?.destination?.payment_rail ?? null,
      amount: transferAmount,
      currency: transferSourceCurrency,
      ...(enforcedCryptoPayout
        ? {
            payout_policy: "bridge_payout_validator_v1",
            developer_fee: enforcedCryptoPayout.developer_fee,
            net_destination_amount: enforcedCryptoPayout.net_destination_amount,
          }
        : {}),
    });
    const result = await bridgeProvider.createTransfer({
      on_behalf_of: profile.bridge_customer_id,
      source: {
        payment_rail: sourceRail,
        currency:     transferSourceCurrency,
        from_address: body.source.from_address,
        bridge_wallet_id: body.source.bridge_wallet_id,
        external_account_id: body.source.external_account_id,
        amount:       transferAmount,
      },
      destination: {
        ...Object.fromEntries(
          Object.entries(body.destination || {}).filter(([key]) => key !== "chain"),
        ),
        payment_rail: enforcedCryptoPayout?.destination_payment_rail ?? body.destination.payment_rail,
        currency: transferDestinationCurrency,
      },
      developer_fee: isFiatExternalOfframp
        ? {
            flat_amount: fixedDeveloperFeeForPercent(
              transferAmount,
              BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp,
            ),
          }
        : undefined,
      ...(sca.required ? { sca_attestation: scaAttestation } : {}),
      // Pass the same canonical key to Bridge so Bridge's own idempotency
      // store dedupes retries too. The shared bridge-client forwards this
      // as the HTTP `Idempotency-Key` header.
      idempotency_key: idem,
    }, walletInitiation);

    // The outgoing write-only field and Bridge's HTTP request/transfer IDs
    // remain queryable independently of webhook metadata replacement.
    const { error: acceptedAuditError } = await supa.from("admin_action_audit").insert({
      actor_id: user.id, role: "system", action_type: "bridge_transfer_initiation_accepted",
      target_resource: result.transfer_id, request_id: idem,
      after_state: { ...initiationEvidence, initiation: result.initiation ?? null,
        bridge_transfer_id: result.transfer_id, bridge_request_id: result.request_id ?? null },
    });
    if (acceptedAuditError) {
      // Money may already have moved. Persist the transfer below; never
      // describe this audit failure as a pre-provider rejection.
      fxLog("bridge_initiation_acceptance_audit_failed", { transfer_id: result.transfer_id, code: acceptedAuditError.code });
    }

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
        transaction_type: transactionType,
        direction: transactionDirection,
        balance_impact: transactionDirection,
        flow: "bridge_transfer",
        source_type: normalizedSourceType,
        destination_type: normalizedDestinationType,
        payout_validator: enforcedCryptoPayout ? "bridge_payout_validator_v1" : null,
        developer_fee: enforcedCryptoPayout ? "0.00" : null,
        developer_fee_percent: enforcedCryptoPayout ? 0 : null,
        bridge_developer_fee: null,
        transfer_method: enforcedCryptoPayout ? "crypto_to_crypto_transfer" : null,
        bridge_payment_route_id: null,
        route_deposit_address: null,
        final_destination_address: enforcedCryptoPayout ? cryptoFinalAddress : null,
        is_cross_token: enforcedCryptoPayout?.is_cross_token ?? null,
        net_destination_amount: enforcedCryptoPayout?.net_destination_amount ?? null,
        sca_required: sca.required,
        sca_country: sca.country,
        sca_scope_reason: sca.scope_reason,
        sca_attestation_outcome: sca.required ? "sca_used" : null,
        sca_authorization_id: sca.required ? String(body?.sca_authorization_id || "") : null,
        bridge_initiation: result.initiation ?? null,
        bridge_initiation_required: walletInitiation?.required ?? false,
        bridge_request_id: result.request_id ?? null,
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
    try {
      await recordTransferProviderAlert({
        user_id: user.id,
        account_type: profile.account_type ?? null,
        source_currency: String(transferSourceCurrency || ""),
        destination_currency: String(transferDestinationCurrency || ""),
        source_payment_rail: sourceRail,
        destination_payment_rail: String(enforcedCryptoPayout?.destination_payment_rail ?? body?.destination?.payment_rail ?? ""),
        idempotency_key: idem,
        error: e,
      });
    } catch (alertErr) {
      fxLog("admin_alert_insert_failed", {
        user_id: user.id,
        idempotency_key: idem,
        error: (alertErr as Error).message,
      });
    }
    fxLog("bridge_request_failed", {
      user_id: user.id,
      idempotency_key: idem,
      error: (e as Error).message,
    });
    return json({
      success: false,
      code: "bridge_provider_error",
      error: "We could not complete this transfer right now. Please try again shortly.",
    }, 502);
  }
});
