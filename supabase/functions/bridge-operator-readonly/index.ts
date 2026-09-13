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
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_ORIGINS = new Set([
  "https://app.borderpayafrica.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://app.borderpayafrica.com",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

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
  if (Array.isArray(payload?.external_accounts)) return payload.external_accounts;
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
  const currency = text(row?.currency ||
    (accountType === "iban" ? "EUR" : accountType === "gb" ? "GBP" : "USD"))
    .toUpperCase();
  const rail = text(row?.payment_rail || row?.rail ||
    (accountType === "iban"
      ? "sepa"
      : accountType === "gb"
      ? "faster_payments"
      : "ach")).toLowerCase();
  const accountNumber = text(
    row?.account_number || row?.account?.account_number || row?.iban_number || row?.iban,
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

async function listTransfers(customerId: string): Promise<any[]> {
  const response = await bridgeFetch({
    method: "GET",
    path: "/v0/transfers",
    query: { customer_id: customerId, limit: 100 },
    retryable: true,
  });
  if (!response.ok) {
    throw new Error(`Bridge transfer read failed (${response.status})`);
  }
  return listRows(response.data).slice(0, 100).map((row) => ({
    id: text(row?.id),
    state: text(row?.state || row?.status).toLowerCase(),
    source: {
      currency: text(row?.source?.currency).toUpperCase(),
      payment_rail: text(row?.source?.payment_rail || row?.source?.rail)
        .toLowerCase(),
      amount: amount(row?.source?.amount),
    },
    destination: {
      currency: text(row?.destination?.currency).toUpperCase(),
      payment_rail: text(
        row?.destination?.payment_rail || row?.destination?.rail,
      ).toLowerCase(),
      amount: amount(row?.destination?.amount || row?.amount),
    },
    created_at: text(row?.created_at),
    updated_at: text(row?.updated_at),
  }));
}

type PlatformActivity = {
  available: boolean;
  transactions: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
};

async function listPlatformActivity(): Promise<PlatformActivity> {
  try {
    const [
      { data: transactions, error: transactionError },
      { data: notifications, error: notificationError },
    ] = await Promise.all([
      db.from("transactions")
        .select(
          "id,user_id,type,status,amount,currency,fee,description,reference,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(1000),
      db.from("notifications")
        .select("id,user_id,type,title,body,is_read,created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (transactionError) throw transactionError;
    if (notificationError) throw notificationError;

    const userIds = Array.from(
      new Set([
        ...(transactions || []).map((row) => text(row.user_id)),
        ...(notifications || []).map((row) => text(row.user_id)),
      ].filter(Boolean)),
    );
    const profileById = new Map<
      string,
      { email: string; full_name: string; account_type: string }
    >();
    const companyById = new Map<string, string>();
    if (userIds.length) {
      const [
        { data: profiles, error: profileError },
        { data: businesses, error: businessError },
      ] = await Promise.all([
        db.from("user_profiles").select("id,email,full_name,account_type").in(
          "id",
          userIds,
        ),
        db.from("business_profiles").select("user_id,company_name").in(
          "user_id",
          userIds,
        ),
      ]);
      if (profileError) throw profileError;
      if (businessError) throw businessError;
      for (const profile of profiles || []) {
        profileById.set(text(profile.id), {
          email: text(profile.email),
          full_name: text(profile.full_name),
          account_type: text(profile.account_type).toLowerCase(),
        });
      }
      for (const business of businesses || []) {
        companyById.set(text(business.user_id), text(business.company_name));
      }
    }

    const identity = (userId: string) => {
      const profile = profileById.get(userId);
      return {
        customer_name: companyById.get(userId) || profile?.full_name ||
          "BorderPay customer",
        customer_email: profile?.email || "",
        account_type: profile?.account_type || "",
      };
    };
    return {
      available: true,
      transactions: (transactions || []).map((row) => ({
        id: text(row.id),
        user_id: text(row.user_id),
        ...identity(text(row.user_id)),
        type: text(row.type).toLowerCase(),
        status: text(row.status).toLowerCase(),
        amount: amount(row.amount),
        currency: text(row.currency).toUpperCase(),
        fee: amount(row.fee),
        description: text(row.description),
        reference: text(row.reference),
        created_at: text(row.created_at),
        updated_at: text(row.updated_at),
      })),
      notifications: (notifications || []).map((row) => ({
        id: text(row.id),
        user_id: text(row.user_id),
        ...identity(text(row.user_id)),
        type: text(row.type).toLowerCase(),
        title: text(row.title),
        body: text(row.body),
        read: row.is_read === true,
        created_at: text(row.created_at),
      })),
    };
  } catch (error) {
    console.warn("operator_platform_activity_unavailable", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { available: false, transactions: [], notifications: [] };
  }
}

function virtualAccountRow(row: any) {
  const details =
    row?.account_details && typeof row.account_details === "object"
      ? row.account_details
      : {};
  const instructions = details?.source_deposit_instructions &&
      typeof details.source_deposit_instructions === "object"
    ? details.source_deposit_instructions
    : details;
  return {
    id: text(row?.virtual_account_id),
    currency: text(row?.currency || instructions?.currency).toUpperCase(),
    rail: text(row?.rail || instructions?.payment_rail).toLowerCase(),
    status: text(row?.status).toLowerCase(),
    account_holder_name: text(
      instructions?.account_holder_name || instructions?.beneficiary_name,
    ),
    bank_name: text(instructions?.bank_name),
    bank_address: text(instructions?.bank_address),
    account_number: text(
      instructions?.bank_account_number || instructions?.account_number,
    ),
    routing_number: text(
      instructions?.bank_routing_number || instructions?.routing_number,
    ),
    iban: text(instructions?.iban),
    bic: text(instructions?.bic || instructions?.swift_code),
    created_at: text(row?.created_at),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) });
  }
  if (req.method !== "POST") {
    return json(req, { success: false, error: "POST only" }, 405);
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
    const destinationRail = text(request?.destination_rail).toLowerCase() as BridgePaymentRail;
    const destinationAddress = text(request?.destination_address);
    const destinationExternalAccountId = text(request?.destination_external_account_id);
    const destinationCurrencyRequested = text(request?.destination_currency).toUpperCase();
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
          error: "The selected bank account is not active on this treasury account.",
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
    const [profile, wallets, virtualAccounts, externalAccountResult, transfers, platformActivity] =
      await Promise.all([
        bridgeProvider.getCustomerProfile(customerId),
        bridgeProvider.listWallets(customerId),
        bridgeProvider.listVirtualAccounts(customerId),
        listExternalAccounts(customerId).then((rows) => ({ available: true, rows }))
          .catch((error) => {
            console.warn("bridge_operator_external_accounts_unavailable", {
              bridge_customer_id: customerId,
              error: error instanceof Error ? error.message : "unknown",
            });
            return { available: false, rows: [] as any[] };
          }),
        listTransfers(customerId),
        listPlatformActivity(),
      ]);
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
          balance: amount(balance.balance),
        })),
      };
    }));

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
        customer_transactions: platformActivity.transactions.length,
        notifications: platformActivity.notifications.length,
        platform_activity_available: platformActivity.available,
      },
    });

    return json(req, {
      success: true,
      data: {
        access_mode: "read_only",
        account: {
          name: text(operator.label || "BorderPay Africa, Inc."),
          customer_id: customerId,
          status: "active",
        },
        wallets: walletRows,
        virtual_accounts: virtualAccounts.slice(0, 100).map(virtualAccountRow),
        external_accounts: externalAccountResult.rows.map(externalAccountRow).filter((account) =>
          account.id && !["deleted", "deactivated", "inactive", "closed"].includes(account.status)
        ),
        external_accounts_available: externalAccountResult.available,
        transactions: transfers,
        customer_transactions: platformActivity.transactions,
        notifications: platformActivity.notifications,
        platform_activity_available: platformActivity.available,
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
