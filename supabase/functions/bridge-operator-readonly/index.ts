import { bridgeMidmarketRate, treasuryUsdTotal, treasuryBalanceHistory } from "./valuation.ts";
import { normalizeTreasuryActivity, mergeTreasuryActivity, readActivityPages } from "./activity.ts";
import { treasuryCors as cors } from "./cors.ts";
import { virtualAccountRows } from "./accounts.ts";
import { guardUnattestedTransfer } from "../_shared/unattested-transfer-guard.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { bridgeFetch } from "../_shared/providers/bridge-client.ts";
import type {
  BridgePaymentRail,
  FiatCurrency,
  StablecoinSymbol,
} from "../_shared/providers/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BRIDGE_BASE_URL =
  (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz")
    .replace(/\/+$/, "");
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});


function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function amount(value: unknown): string {
  const raw = text(value);
  return /^-?\d+(\.\d+)?$/.test(raw) ? raw : "0";
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 &&
    value.length <= 128 && /^[\x21-\x7e]+$/.test(value);
}

function validAddress(chain: string, value: string): boolean {
  if (chain === "base" || chain === "ethereum") {
    return /^0x[0-9a-fA-F]{40}$/.test(value);
  }
  if (chain === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  if (chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  return false;
}

const TREASURY_ASSETS = [
  { currency: "USDC", chain: "base" },
  { currency: "EURC", chain: "base" },
  { currency: "USDT", chain: "tron" },
] as const;

// The master account has historical Base wallets. Only this wallet backs its
// live virtual-account settlement routes and may be exposed by Treasury.
const TREASURY_CANONICAL_BASE_ADDRESS =
  "0x00287b1e51e21c2f593f654b17c4b22c6e67399f";

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((part) =>
    part.toString(16).padStart(2, "0")
  ).join("");
}

async function verifyTransactionPin(authorization: string, pin: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-pin`, {
    method: "POST",
    headers: {
      "Authorization": authorization,
      "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pin }),
  });
  const result = await response.json().catch(() => ({}));
  return {
    ok: response.ok && result?.success === true,
    status: response.status,
  };
}

function listRows(payload: any): any[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.transfers)) return payload.transfers;
  if (Array.isArray(payload?.activities)) return payload.activities;
  if (Array.isArray(payload?.history)) return payload.history;
  if (Array.isArray(payload?.external_accounts)) {
    return payload.external_accounts;
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

async function listExternalAccounts(customerId: string): Promise<any[]> {
  const response = await bridgeFetch({
    method: "GET",
    path: `/v0/customers/${encodeURIComponent(customerId)}/external_accounts`,
    retryable: true,
  });
  if (!response.ok) {
    throw new Error(`External-account read failed (${response.status})`);
  }
  return listRows(response.data);
}

function externalAccountRow(row: any) {
  const accountType = text(row?.account_type).toLowerCase();
  const currency = text(
    row?.currency ||
      (accountType === "iban" ? "EUR" : accountType === "gb" ? "GBP" : "USD"),
  )
    .toUpperCase();
  const rail = text(
    row?.payment_rail || row?.rail ||
      (accountType === "iban"
        ? "sepa"
        : accountType === "gb"
        ? "faster_payments"
        : "ach"),
  ).toLowerCase();
  const accountNumber = text(
    row?.account_number || row?.account?.account_number || row?.iban_number ||
      row?.iban,
  ).replace(/\s+/g, "");
  return {
    id: text(row?.id || row?.external_account_id),
    account_type: accountType,
    currency,
    rail,
    status: text(row?.status || "active").toLowerCase(),
    account_owner_name: text(row?.account_owner_name || row?.business_name),
    bank_name: text(row?.bank_name),
    last_4: text(row?.last_4 || accountNumber.slice(-4)),
  };
}

async function listTransfers(customerId: string) {
  const result = await readActivityPages((cursor) => bridgeFetch({
    method: "GET",
    path: `/v0/customers/${encodeURIComponent(customerId)}/transfers`,
    query: { limit: 100, ...(cursor ? { starting_after: cursor } : {}) },
    retryable: true,
  }), customerId);
  return { ...result, rows: result.rows.map(row => normalizeTreasuryActivity(row, "transfer")) };
}

async function listVirtualAccountHistory(customerId: string, virtualAccountId: string, sourceCurrency: string) {
  const result = await readActivityPages((cursor) => bridgeFetch({
    method: "GET",
    path: `/v0/customers/${encodeURIComponent(customerId)}/virtual_accounts/${encodeURIComponent(virtualAccountId)}/history`,
    query: { limit: 100, ...(cursor ? { starting_after: cursor } : {}) },
    retryable: true,
  }), customerId);
  return { ...result, rows: result.rows.map(row => normalizeTreasuryActivity(row, "virtual_account", { sourceCurrency })) };
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) });
  }
  if (req.method !== "POST") {
    return json(req, { success: false, error: "POST only" }, 405);
  }
  // This endpoint is exclusively for BorderPay's master production treasury.
  // Never render or move sandbox data under a production operator identity.
  if (BRIDGE_BASE_URL !== "https://api.bridge.xyz") {
    console.error("bridge_operator_nonproduction_base_url", {
      base_url: BRIDGE_BASE_URL,
    });
    return json(req, {
      success: false,
      error:
        "Production treasury data is unavailable because the provider environment is misconfigured",
    }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  if (!token) {
    return json(req, { success: false, error: "Authentication required" }, 401);
  }
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData?.user;
  const email = text(user?.email).toLowerCase();
  if (authError || !user || !email || !user.email_confirmed_at) {
    return json(req, { success: false, error: "Authentication required" }, 401);
  }

  const { data: access, error: accessError } = await db
    .from("operator_bridge_app_access")
    .select("bridge_customer_id,access_mode,can_transfer,active")
    .eq("auth_email", email)
    .eq("active", true)
    .maybeSingle();
  if (accessError) {
    return json(req, {
      success: false,
      error: "Operator access could not be verified",
    }, 503);
  }
  if (!access || access.access_mode !== "read_only") {
    return json(req, {
      success: false,
      error: "Operator access is not enabled",
    }, 403);
  }

  const customerId = text(access.bridge_customer_id);
  const { data: operator, error: operatorError } = await db
    .from("operator_bridge_accounts")
    .select("label,active")
    .eq("bridge_customer_id", customerId)
    .eq("active", true)
    .maybeSingle();
  if (operatorError || !operator) {
    return json(req, {
      success: false,
      error: "Operator account is unavailable",
    }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = text(body?.action || "snapshot").toLowerCase();
  if (action === "transfer") {
    if (access.can_transfer !== true) {
      return json(req, {
        success: false,
        code: "operator_transfer_not_allowed",
        error: "Transfer access is not enabled for this operator.",
      }, 403);
    }
    if (
      (Deno.env.get("OPERATOR_BRIDGE_TRANSFERS_ENABLED") || "")
        .toLowerCase() !== "true"
    ) {
      return json(req, {
        success: false,
        code: "operator_transfers_disabled",
        error: "Operator transfers are currently disabled.",
      }, 503);
    }
    const request = body?.request && typeof body.request === "object"
      ? body.request
      : {};
    const sourceWalletId = text(request?.source_wallet_id);
    const currency = text(request?.currency).toUpperCase() as StablecoinSymbol;
    const destinationRail = text(request?.destination_rail)
      .toLowerCase() as BridgePaymentRail;
    const destinationAddress = text(request?.destination_address);
    const destinationExternalAccountId = text(
      request?.destination_external_account_id,
    );
    const destinationCurrencyRequested = text(request?.destination_currency)
      .toUpperCase();
    const isFiatPayout = Boolean(destinationExternalAccountId);
    const amountRaw = text(request?.amount);
    const numericAmount = Number(amountRaw);
    const idempotencyKey = text(request?.idempotency_key);
    const pin = text(body?.pin);
    if (
      !sourceWalletId || !["USDC", "USDT", "EURC"].includes(currency) ||
      !Number.isFinite(numericAmount) || numericAmount <= 0 ||
      !/^\d+(\.\d{1,12})?$/.test(amountRaw)
    ) {
      return json(req, {
        success: false,
        code: "invalid_transfer",
        error: "Choose a wallet and enter a valid positive amount.",
      }, 400);
    }
    if (!validIdempotencyKey(idempotencyKey)) {
      return json(req, {
        success: false,
        code: "idempotency_required",
        error: "A valid transfer idempotency key is required.",
      }, 400);
    }
    if (!isFiatPayout && !validAddress(destinationRail, destinationAddress)) {
      return json(req, {
        success: false,
        code: "invalid_destination",
        error: "The destination address does not match the selected network.",
      }, 400);
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return json(req, {
        success: false,
        code: "transaction_pin_required",
        error: "Your transaction PIN is required.",
      }, 400);
    }

    const requestBody = {
      source_wallet_id: sourceWalletId,
      currency,
      destination_rail: destinationRail,
      destination_address: destinationAddress,
      destination_external_account_id: destinationExternalAccountId,
      destination_currency: destinationCurrencyRequested,
      amount: amountRaw,
    };
    const requestHash = await sha256(requestBody);
    const { data: existingIntent } = await db.from(
      "operator_bridge_transfer_intents",
    )
      .select("request_hash,status,bridge_transfer_id,bridge_state")
      .eq("auth_email", email).eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingIntent) {
      if (existingIntent.request_hash !== requestHash) {
        return json(req, {
          success: false,
          code: "idempotency_conflict",
          error: "This transfer key was already used for a different request.",
        }, 409);
      }
      if (existingIntent.bridge_transfer_id) {
        return json(req, {
          success: true,
          data: {
            transfer_id: existingIntent.bridge_transfer_id,
            state: existingIntent.bridge_state || "pending",
            replayed: true,
          },
        });
      }
      return json(req, {
        success: false,
        code: "transfer_in_progress",
        error: "This transfer is already being processed.",
      }, 409);
    }

    const wallets = await bridgeProvider.listWallets(customerId);
    const wallet = wallets.find((entry) => entry.wallet_id === sourceWalletId);
    if (!wallet) {
      return json(req, {
        success: false,
        code: "wallet_not_owned",
        error: "The selected wallet does not belong to this treasury account.",
      }, 403);
    }
    const walletChain = text(wallet.chain).toLowerCase();
    if (
      walletChain === "base" &&
      text(wallet.address).toLowerCase() !== TREASURY_CANONICAL_BASE_ADDRESS
    ) {
      return json(req, {
        success: false,
        code: "noncanonical_treasury_wallet",
        error: "This Base wallet is not enabled for the treasury account.",
      }, 403);
    }
    if (!isFiatPayout && walletChain !== destinationRail) {
      return json(req, {
        success: false,
        code: "network_mismatch",
        error: "Source and destination networks must match.",
      }, 400);
    }
    const allowedTreasuryAsset = TREASURY_ASSETS.some((asset) =>
      asset.currency === currency && asset.chain === walletChain
    );
    if (!allowedTreasuryAsset) {
      return json(req, {
        success: false,
        code: "unsupported_treasury_asset",
        error: "This wallet asset is not enabled in BorderPay Treasury.",
      }, 400);
    }
    let fiatDestination:
      | {
        id: string;
        currency: Extract<FiatCurrency, "USD" | "EUR" | "GBP">;
        rail: BridgePaymentRail;
      }
      | null = null;
    if (isFiatPayout) {
      if (!["USDC", "USDT"].includes(currency)) {
        return json(req, {
          success: false,
          code: "unsupported_fiat_source",
          error: "Fiat payouts must use an available USDC or USDT balance.",
        }, 400);
      }
      const externalAccounts = (await listExternalAccounts(customerId))
        .map(externalAccountRow);
      const externalAccount = externalAccounts.find((entry) =>
        entry.id === destinationExternalAccountId &&
        !["deleted", "deactivated", "inactive", "closed"].includes(entry.status)
      );
      if (!externalAccount) {
        return json(req, {
          success: false,
          code: "external_account_not_owned",
          error:
            "The selected bank account is not active on this treasury account.",
        }, 403);
      }
      if (
        !["USD", "EUR", "GBP"].includes(externalAccount.currency) ||
        ![
          "ach",
          "wire",
          "ach_push",
          "ach_same_day",
          "fednow",
          "sepa",
          "faster_payments",
        ].includes(externalAccount.rail)
      ) {
        return json(req, {
          success: false,
          code: "unsupported_external_account",
          error: "This bank-account payout route is not supported.",
        }, 400);
      }
      if (
        destinationCurrencyRequested &&
        destinationCurrencyRequested !== externalAccount.currency
      ) {
        return json(req, {
          success: false,
          code: "external_account_currency_mismatch",
          error: "The selected currency does not match the bank account.",
        }, 400);
      }
      fiatDestination = {
        id: externalAccount.id,
        currency: externalAccount.currency as Extract<
          FiatCurrency,
          "USD" | "EUR" | "GBP"
        >,
        rail: externalAccount.rail as BridgePaymentRail,
      };
    }
    const balances: Array<Record<string, unknown>> = await bridgeProvider
      .getWalletBalances(customerId, sourceWalletId);
    const available = balances.filter((row: Record<string, unknown>) =>
      text(row.currency).toUpperCase() === currency
    )
      .reduce(
        (sum: number, row: Record<string, unknown>) =>
          sum + Number(amount(row.balance)),
        0,
      );
    if (!Number.isFinite(available) || available < numericAmount) {
      return json(req, {
        success: false,
        code: "insufficient_balance",
        error: `Insufficient ${currency} balance.`,
      }, 402);
    }

    const scaGuard = await guardUnattestedTransfer(db, { customerId });
    if (!scaGuard.ok) return json(req, scaGuard.body, scaGuard.status);

    const authorization = req.headers.get("Authorization") || "";
    const pinResult = await verifyTransactionPin(authorization, pin);
    if (!pinResult.ok) {
      return json(req, {
        success: false,
        code: "pin_rejected",
        error: "The transaction PIN was not accepted.",
      }, pinResult.status === 423 ? 423 : 401);
    }

    const { error: claimError } = await db.from(
      "operator_bridge_transfer_intents",
    ).insert({
      auth_user_id: user.id,
      auth_email: email,
      bridge_customer_id: customerId,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      status: "pending",
    });
    if (claimError) {
      return json(req, {
        success: false,
        code: "transfer_in_progress",
        error: "This transfer is already being processed.",
      }, 409);
    }

    try {
      const result = await bridgeProvider.createTransfer({
        on_behalf_of: customerId,
        source: {
          payment_rail: "bridge_wallet",
          currency,
          bridge_wallet_id: sourceWalletId,
          amount: amountRaw,
        },
        destination: fiatDestination
          ? {
            payment_rail: fiatDestination.rail,
            currency: fiatDestination.currency,
            external_account_id: fiatDestination.id,
          }
          : {
            payment_rail: destinationRail,
            currency,
            address: destinationAddress,
          },
        idempotency_key: `borderpay:operator:${user.id}:${idempotencyKey}`,
      });
      await db.from("operator_bridge_transfer_intents").update({
        status: "submitted",
        bridge_transfer_id: result.transfer_id,
        bridge_state: result.state,
        updated_at: new Date().toISOString(),
      }).eq("auth_email", email).eq("idempotency_key", idempotencyKey);
      await db.from("operator_bridge_read_audit").insert({
        auth_user_id: user.id,
        auth_email: email,
        bridge_customer_id: customerId,
        action: "transfer",
        succeeded: true,
        metadata: {
          transfer_id: result.transfer_id,
          state: result.state,
          request_hash: requestHash,
        },
      });
      return json(req, {
        success: true,
        data: { transfer_id: result.transfer_id, state: result.state },
      });
    } catch (error) {
      const providerError = error as Error & {
        bridge_code?: string;
        request_id?: string;
      };
      await db.from("operator_bridge_transfer_intents").update({
        status: "failed",
        error_code: text(providerError.bridge_code || "provider_error"),
        updated_at: new Date().toISOString(),
      }).eq("auth_email", email).eq("idempotency_key", idempotencyKey);
      await db.from("operator_bridge_read_audit").insert({
        auth_user_id: user.id,
        auth_email: email,
        bridge_customer_id: customerId,
        action: "transfer",
        succeeded: false,
        metadata: {
          error: providerError.message.slice(0, 300),
          provider_request_id: text(providerError.request_id),
          request_hash: requestHash,
        },
      });
      return json(req, {
        success: false,
        code: "provider_transfer_failed",
        error:
          "Bridge did not accept the transfer. No retry was submitted automatically.",
      }, 502);
    }
  }
  if (action !== "snapshot") {
    return json(req, { success: false, error: "Unsupported action" }, 400);
  }

  try {
    const [
      profileResult,
      walletResult,
      virtualAccountResult,
      externalAccountResult,
      transferResult,
    ] = await Promise.all([
      bridgeProvider.getCustomerProfile(customerId)
        .then((data) => ({ available: true, data }))
        .catch((error) => {
          console.warn("bridge_operator_profile_unavailable", {
            bridge_customer_id: customerId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { available: false, data: null };
        }),
      bridgeProvider.listWallets(customerId)
        .then((rows) => ({ available: true, rows }))
        .catch((error) => {
          console.warn("bridge_operator_wallets_unavailable", {
            bridge_customer_id: customerId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { available: false, rows: [] as any[] };
        }),
      bridgeProvider.listVirtualAccounts(customerId)
        .then((rows) => ({ available: true, rows }))
        .catch((error) => {
          console.warn("bridge_operator_virtual_accounts_unavailable", {
            bridge_customer_id: customerId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { available: false, rows: [] as any[] };
        }),
      listExternalAccounts(customerId).then((rows) => ({
        available: true,
        rows,
      }))
        .catch((error) => {
          console.warn("bridge_operator_external_accounts_unavailable", {
            bridge_customer_id: customerId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { available: false, rows: [] as any[] };
        }),
      listTransfers(customerId)
        .then((result) => ({ available: true, ...result }))
        .catch((error) => {
          console.warn("bridge_operator_transfers_unavailable", {
            bridge_customer_id: customerId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { available: false, complete: false, rows: [] as any[] };
        }),
    ]);
    const wallets = walletResult.rows;
    const virtualAccounts = virtualAccountResult.rows;
    const virtualAccountActivityResults = virtualAccountResult.available
      ? await Promise.all(virtualAccounts.map(async (account) => {
        const virtualAccountId = text(account?.virtual_account_id);
        if (!virtualAccountId) return { available: false, complete: false, rows: [] as any[] };
        return listVirtualAccountHistory(customerId, virtualAccountId, text(account.currency).toUpperCase())
          .then((result) => ({ available: true, ...result }))
          .catch((error) => {
            console.warn(
              "bridge_operator_virtual_account_history_unavailable",
              {
                bridge_customer_id: customerId,
                virtual_account_id: virtualAccountId,
                error: error instanceof Error ? error.message : "unknown",
              },
            );
            return { available: false, complete: false, rows: [] as any[] };
          });
      }))
      : [];
    const virtualAccountHistoryAvailable = virtualAccountActivityResults.some((
      result,
    ) => result.available);
    const transfers = mergeTreasuryActivity(
      transferResult.rows,
      ...virtualAccountActivityResults.map((result) => result.rows),
    );
    const activityHistoryComplete = transferResult.available && transferResult.complete &&
      virtualAccountResult.available && virtualAccountActivityResults.every(result => result.available && result.complete);
    const selectedWallets = TREASURY_ASSETS.flatMap((asset) => {
      const matches = wallets.filter((wallet) =>
        text(wallet.chain).toLowerCase() === asset.chain
      );
      const eligibleMatches = asset.chain === "base"
        ? matches.filter((wallet) =>
          text(wallet.address).toLowerCase() === TREASURY_CANONICAL_BASE_ADDRESS
        )
        : matches;
      const wallet = eligibleMatches.find((candidate) =>
        text(candidate.status || "active").toLowerCase() === "active"
      ) || eligibleMatches[0];
      return wallet
        ? [{ ...wallet, currency: asset.currency, chain: asset.chain }]
        : [];
    });
    const balanceRequests = new Map<
      string,
      Promise<{ available: boolean; rows: Array<Record<string, unknown>> }>
    >();
    const balancesFor = (walletId: string) => {
      const existing = balanceRequests.get(walletId);
      if (existing) return existing;
      const request = bridgeProvider.getWalletBalances(customerId, walletId)
        .then((rows) => ({
          available: true,
          rows: rows as Array<Record<string, unknown>>,
        }))
        .catch((error) => {
          console.warn("bridge_operator_wallet_balance_unavailable", {
            auth_user_id: user.id,
            bridge_customer_id: customerId,
            wallet_id: walletId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return {
            available: false,
            rows: [] as Array<Record<string, unknown>>,
          };
        });
      balanceRequests.set(walletId, request);
      return request;
    };
    const walletRows = await Promise.all(selectedWallets.map(async (wallet) => {
      let balances: Array<Record<string, unknown>> = [];
      const balanceResult = await balancesFor(wallet.wallet_id);
      const balanceAvailable = balanceResult.available;
      if (balanceAvailable) {
        const matching = balanceResult.rows.filter((balance) =>
          text(balance.currency).toUpperCase() ===
            text(wallet.currency).toUpperCase()
        );
        balances = matching.length ? matching : [{
          currency: wallet.currency,
          chain: wallet.chain,
          balance: "0",
        }];
      }
      return {
        id: wallet.wallet_id,
        currency: text(wallet.currency).toUpperCase(),
        chain: text(wallet.chain).toLowerCase(),
        address: text(wallet.address),
        status: text(wallet.status || "active").toLowerCase(),
        balance_available: balanceAvailable,
        balances: balances.map((balance: Record<string, unknown>) => ({
          currency: text(balance.currency).toUpperCase(),
          chain: text(balance.chain).toLowerCase(),
          balance: /^\d+(\.\d+)?$/.test(text(balance.balance)) ? text(balance.balance) : "",
        })),
      };
    }));

    // Optional valuation/history reads must not hold the entire snapshot open.
    async function boundedRead<T>(work: Promise<T>, fallback: T, milliseconds: number): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([work, new Promise<T>(resolve => {
          timer = setTimeout(() => resolve(fallback), milliseconds);
        })]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
    }
    const uniqueWalletIds = [...new Set(walletRows.map(wallet => wallet.id))];
    const [eurRateResponse, usdtRateResponse, ...walletHistoryResults] = await Promise.all([
      boundedRead(bridgeFetch({ method: "GET", path: "/v0/exchange_rates", query: { from: "eur", to: "usd" }, retryable: false }).catch(() => ({ ok: false, data: null })), { ok: false, data: null }, 4_000),
      boundedRead(bridgeFetch({ method: "GET", path: "/v0/exchange_rates", query: { from: "usdt", to: "usd" }, retryable: false }).catch(() => ({ ok: false, data: null })), { ok: false, data: null }, 4_000),
      ...uniqueWalletIds.map(walletId => boundedRead((async () => {
        try {
          const history = await readActivityPages(cursor => bridgeFetch({
            method: "GET", path: `/v0/wallets/${encodeURIComponent(walletId)}/history`,
            query: { limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, retryable: false,
          }), customerId);
          if (history.rows.some(row => row.bridge_wallet_id !== walletId)) throw new Error("Wallet history owner mismatch");
          return history;
        } catch { return { complete: false, rows: [] as any[] }; }
      })(), { complete: false, rows: [] as any[] }, 8_000)),
    ]);
    const valuationTime = Date.now();
    const eurResponse = eurRateResponse as { ok: boolean; data: unknown };
    const usdtResponse = usdtRateResponse as { ok: boolean; data: unknown };
    const rates = {
      USDC: 1,
      EURC: eurResponse.ok ? bridgeMidmarketRate(eurResponse.data, valuationTime) : null,
      USDT: usdtResponse.ok ? bridgeMidmarketRate(usdtResponse.data, valuationTime) : null,
    };
    const historyResults = walletHistoryResults as Array<{ complete: boolean; rows: any[] }>;
    const totalUsd = treasuryUsdTotal(walletRows, walletResult.available, rates);
    const balanceHistory = treasuryBalanceHistory(walletRows, historyResults.flatMap(result => result.rows),
      walletResult.available && historyResults.every(result => result.complete), rates, valuationTime);
    const treasuryValuation = {
      currency: "USD", total: totalUsd === null ? null : totalUsd.toFixed(2),
      rates, as_of: new Date(valuationTime).toISOString(), source: "bridge_wallets_and_midmarket_rates",
      history: balanceHistory,
    };

    await db.from("operator_bridge_read_audit").insert({
      auth_user_id: user.id,
      auth_email: email,
      bridge_customer_id: customerId,
      action: "snapshot",
      succeeded: true,
      metadata: {
        wallets: walletRows.length,
        virtual_accounts: virtualAccounts.length,
        transfers: transfers.length,
        virtual_account_history_available: virtualAccountHistoryAvailable,
        profile_available: profileResult.available,
        wallets_available: walletResult.available,
        virtual_accounts_available: virtualAccountResult.available,
        transfers_available: transferResult.available,
      },
    });

    return json(req, {
      success: true,
      data: {
        source: "bridge_production_live",
        access_mode: "read_only",
        account: {
          name: text(operator.label || "BorderPay Africa, Inc."),
          customer_id: customerId,
          status: "active",
        },
        wallets: walletRows,
        virtual_accounts: virtualAccounts.slice(0, 100).flatMap(
          virtualAccountRows,
        ),
        virtual_accounts_available: virtualAccountResult.available,
        external_accounts: externalAccountResult.rows.map(externalAccountRow)
          .filter((account) =>
            account.id &&
            !["deleted", "deactivated", "inactive", "closed"].includes(
              account.status,
            )
          ),
        external_accounts_available: externalAccountResult.available,
        treasury_valuation: treasuryValuation,
        transactions: transfers,
        activity_history_complete: activityHistoryComplete,
        transfers_available: transferResult.available ||
          virtualAccountHistoryAvailable,
        virtual_account_history_available: virtualAccountHistoryAvailable,
        wallets_available: walletResult.available,
        profile_available: profileResult.available,
        refreshed_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    await db.from("operator_bridge_read_audit").insert({
      auth_user_id: user.id,
      auth_email: email,
      bridge_customer_id: customerId,
      action: "snapshot",
      succeeded: false,
      metadata: {
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      },
    });
    console.error("bridge_operator_readonly_failed", {
      auth_user_id: user.id,
      bridge_customer_id: customerId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(req, {
      success: false,
      error: "Bridge account data is temporarily unavailable",
    }, 502);
  }
});
