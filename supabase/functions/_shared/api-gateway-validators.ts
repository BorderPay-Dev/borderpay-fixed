export type ValidationFailure = {
  code: "invalid_request";
  message: string;
  details?: Record<string, unknown>;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationFailure };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_RE = /^\d+(\.\d{1,12})?$/;

const ACCOUNT_TYPES = new Set(["individual", "business"]);
const VA_FIAT_CURRENCIES = new Set(["USD", "EUR", "GBP"]);
const STABLECOIN_SYMBOLS = new Set(["USDC", "USDT", "PYUSD", "USDB", "EURC"]);
const STABLECOIN_CHAINS = new Set([
  "ETH",
  "SOL",
  "BSC",
  "POLYGON",
  "TRON",
  "BASE",
  "OPTIMISM",
  "ARBITRUM",
]);
const BRIDGE_CHAIN_RAILS = new Set(["base", "tron"]);
const SOURCE_RAILS = new Set([
  "base",
  "tron",
  "ach",
  "wire",
  "sepa",
  "bridge_wallet",
  "external_account",
]);
const DEST_RAILS = new Set([
  "base",
  "tron",
  "ach",
  "wire",
  "sepa",
  "mobile_money",
  "local_bank",
  "bridge_wallet",
  "external_account",
]);

function invalid(
  message: string,
  details?: Record<string, unknown>,
): ValidationResult<never> {
  return { ok: false, error: { code: "invalid_request", message, details } };
}

function stringField(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function requiredString(v: unknown, field: string): ValidationResult<string> {
  const s = stringField(v);
  if (!s) return invalid(`${field} is required`, { field });
  return { ok: true, value: s };
}

function optionalString(v: unknown): string | undefined {
  const s = stringField(v);
  return s || undefined;
}

function optionalUuid(v: unknown): string | undefined {
  const s = stringField(v);
  if (!s) return undefined;
  return UUID_RE.test(s) ? s : undefined;
}

export type CustomerCreateInput = {
  account_type: "individual" | "business";
  email: string;
  country_code: string;
  full_name?: string;
  company_name?: string;
  registration_number?: string;
  phone_e164?: string;
  borderpay_user_id: string;
};

export type OnboardingAuthorizationInput = {
  external_user_id: string;
  onboarding_channel: "api" | "white_label";
  requested_account_types?: Array<"individual" | "business">;
  expires_in_seconds: number;
};

export function validateOnboardingAuthorization(
  body: any,
): ValidationResult<OnboardingAuthorizationInput> {
  const externalUserId = stringField(body?.external_user_id);
  if (!externalUserId || externalUserId.length > 200) {
    return invalid(
      "external_user_id is required and must be at most 200 characters",
      {
        field: "external_user_id",
      },
    );
  }
  const channel = stringField(body?.onboarding_channel).toLowerCase();
  if (channel !== "api" && channel !== "white_label") {
    return invalid("onboarding_channel must be api|white_label", {
      field: "onboarding_channel",
    });
  }
  let requested: Array<"individual" | "business"> | undefined;
  if (body?.requested_account_types != null) {
    if (!Array.isArray(body.requested_account_types)) {
      return invalid("requested_account_types must be an array", {
        field: "requested_account_types",
      });
    }
    requested = Array.from(
      new Set(
        body.requested_account_types.map((value: unknown) =>
          stringField(value).toLowerCase()
        ),
      ),
    )
      .filter((value): value is "individual" | "business" =>
        value === "individual" || value === "business"
      );
    if (
      requested.length !== body.requested_account_types.length ||
      requested.length === 0
    ) {
      return invalid(
        "requested_account_types may contain only individual|business",
        {
          field: "requested_account_types",
        },
      );
    }
  }
  const requestedTtl = Number(body?.expires_in_seconds ?? 600);
  if (
    !Number.isFinite(requestedTtl) || requestedTtl < 60 || requestedTtl > 900
  ) {
    return invalid("expires_in_seconds must be between 60 and 900", {
      field: "expires_in_seconds",
    });
  }
  return {
    ok: true,
    value: {
      external_user_id: externalUserId,
      onboarding_channel: channel,
      requested_account_types: requested,
      expires_in_seconds: Math.floor(requestedTtl),
    },
  };
}

export function validateCustomerCreate(
  body: any,
): ValidationResult<CustomerCreateInput> {
  const account = stringField(body?.account_type).toLowerCase();
  if (!ACCOUNT_TYPES.has(account)) {
    return invalid("account_type must be individual|business", {
      field: "account_type",
    });
  }

  const email = stringField(body?.email);
  if (!EMAIL_RE.test(email)) {
    return invalid("email must be valid", { field: "email" });
  }

  const country = stringField(body?.country_code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return invalid("country_code must be ISO-3166 alpha-2", {
      field: "country_code",
    });
  }

  const borderpayUserId = stringField(body?.borderpay_user_id);
  if (!borderpayUserId) {
    return invalid("borderpay_user_id is required", {
      field: "borderpay_user_id",
    });
  }

  if (account === "individual") {
    const fullName = optionalString(body?.full_name);
    if (!fullName || fullName.length < 2) {
      return invalid("full_name is required for individual account_type", {
        field: "full_name",
      });
    }
  }

  if (account === "business") {
    const companyName = optionalString(body?.company_name);
    if (!companyName || companyName.length < 2) {
      return invalid("company_name is required for business account_type", {
        field: "company_name",
      });
    }
  }

  return {
    ok: true,
    value: {
      account_type: account as "individual" | "business",
      email,
      country_code: country,
      full_name: optionalString(body?.full_name),
      company_name: optionalString(body?.company_name),
      registration_number: optionalString(body?.registration_number),
      phone_e164: optionalString(body?.phone_e164),
      borderpay_user_id: borderpayUserId,
    },
  };
}

export type WalletCreateInput = {
  customer_id: string;
  symbol: "USDC" | "USDT" | "PYUSD" | "USDB" | "EURC";
  chain:
    | "ETH"
    | "SOL"
    | "BSC"
    | "POLYGON"
    | "TRON"
    | "BASE"
    | "OPTIMISM"
    | "ARBITRUM";
};

export function validateWalletCreate(
  body: any,
): ValidationResult<WalletCreateInput> {
  const customerId = stringField(body?.customer_id);
  if (!customerId) {
    return invalid("customer_id is required", { field: "customer_id" });
  }

  const symbol = stringField(body?.symbol).toUpperCase();
  if (!STABLECOIN_SYMBOLS.has(symbol)) {
    return invalid("symbol unsupported", {
      field: "symbol",
      allowed: Array.from(STABLECOIN_SYMBOLS),
    });
  }

  const chain = stringField(body?.chain).toUpperCase();
  if (!STABLECOIN_CHAINS.has(chain)) {
    return invalid("chain unsupported", {
      field: "chain",
      allowed: Array.from(STABLECOIN_CHAINS),
    });
  }

  return {
    ok: true,
    value: {
      customer_id: customerId,
      symbol: symbol as WalletCreateInput["symbol"],
      chain: chain as WalletCreateInput["chain"],
    },
  };
}

export type VirtualAccountCreateInput = {
  customer_id: string;
  currency: "USD" | "EUR" | "GBP";
  destination: {
    payment_rail: "base" | "tron";
    currency: "USDC" | "USDT";
    bridge_wallet_id: string;
  };
};

export function validateVirtualAccountCreate(
  body: any,
): ValidationResult<VirtualAccountCreateInput> {
  const customerId = stringField(body?.customer_id);
  if (!customerId) {
    return invalid("customer_id is required", { field: "customer_id" });
  }

  const currency = stringField(body?.currency).toUpperCase();
  if (!VA_FIAT_CURRENCIES.has(currency)) {
    return invalid("currency must be USD|EUR|GBP", {
      field: "currency",
      allowed: Array.from(VA_FIAT_CURRENCIES),
    });
  }

  const destination = body?.destination ?? {};
  const rail = stringField(destination?.payment_rail).toLowerCase();
  if (rail !== "base" && rail !== "tron") {
    return invalid("destination.payment_rail must be base|tron", {
      field: "destination.payment_rail",
    });
  }

  const dcy = stringField(destination?.currency).toUpperCase();
  if (
    !((rail === "base" && dcy === "USDC") ||
      (rail === "tron" && dcy === "USDT"))
  ) {
    return invalid("destination must be USDC/base or USDT/tron", {
      field: "destination.currency",
    });
  }

  const bridgeWalletId = stringField(destination?.bridge_wallet_id);
  if (!bridgeWalletId) {
    return invalid("destination.bridge_wallet_id is required", {
      field: "destination.bridge_wallet_id",
    });
  }

  return {
    ok: true,
    value: {
      customer_id: customerId,
      currency: currency as "USD" | "EUR" | "GBP",
      destination: {
        payment_rail: rail,
        currency: dcy,
        bridge_wallet_id: bridgeWalletId,
      },
    },
  };
}

export type TransferInput = {
  source: {
    payment_rail: "bridge_wallet";
    currency: "USDC" | "USDT";
    amount: string;
    bridge_wallet_id: string;
  };
  destination: {
    payment_rail: "bridge_wallet" | "ach" | "wire" | "sepa" | "faster_payments";
    currency: string;
    bridge_wallet_id?: string;
    external_account_id?: string;
  };
  idempotency_key: string;
};

export function validateTransferOrPayout(
  body: any,
  routeKind: "transfer" | "payout",
): ValidationResult<TransferInput> {
  const transfer = body?.transfer ?? body ?? {};

  const idem = stringField(transfer?.idempotency_key);
  if (!idem) {
    return invalid("idempotency_key is required in body.transfer or body", {
      field: "idempotency_key",
    });
  }

  const source = transfer?.source;
  if (!source || typeof source !== "object") {
    return invalid("source object is required", { field: "source" });
  }
  const destination = transfer?.destination;
  if (!destination || typeof destination !== "object") {
    return invalid("destination object is required", { field: "destination" });
  }

  if (
    transfer?.developer_fee != null || transfer?.on_behalf_of != null ||
    (destination as any).bank_account != null ||
    (destination as any).address != null
  ) {
    return invalid(
      "caller-supplied fees, customer authority, bank details, and raw addresses are not accepted",
      {
        field: "transfer",
      },
    );
  }

  const sourceRail = stringField((source as any).payment_rail).toLowerCase();
  if (sourceRail !== "bridge_wallet") {
    return invalid("source.payment_rail must be bridge_wallet", {
      field: "source.payment_rail",
    });
  }

  const amount = stringField((source as any).amount);
  if (!MONEY_RE.test(amount) || Number(amount) <= 0) {
    return invalid("source.amount must be positive decimal string", {
      field: "source.amount",
    });
  }

  const sourceCurrency = stringField((source as any).currency).toUpperCase();
  const destCurrency = stringField((destination as any).currency).toUpperCase();
  if (sourceCurrency !== "USDC" && sourceCurrency !== "USDT") {
    return invalid("source.currency must be USDC|USDT", {
      field: "source.currency",
    });
  }
  if (!destCurrency) {
    return invalid("destination.currency is required", {
      field: "destination.currency",
    });
  }

  const sourceWalletId = stringField((source as any).bridge_wallet_id);
  if (!sourceWalletId) {
    return invalid("source.bridge_wallet_id is required", {
      field: "source.bridge_wallet_id",
    });
  }

  if (routeKind === "transfer") {
    const destinationWalletId = stringField(
      (destination as any).bridge_wallet_id,
    );
    if (
      stringField((destination as any).payment_rail).toLowerCase() !==
        "bridge_wallet" || !destinationWalletId
    ) {
      return invalid(
        "transfers require destination.payment_rail=bridge_wallet and destination.bridge_wallet_id",
        {
          field: "destination.bridge_wallet_id",
        },
      );
    }
    if (destCurrency !== sourceCurrency) {
      return invalid(
        "wallet transfers must use the same source and destination currency",
        {
          field: "destination.currency",
        },
      );
    }
    return {
      ok: true,
      value: {
        source: {
          payment_rail: "bridge_wallet",
          currency: sourceCurrency,
          amount,
          bridge_wallet_id: sourceWalletId,
        },
        destination: {
          payment_rail: "bridge_wallet",
          currency: destCurrency,
          bridge_wallet_id: destinationWalletId,
        },
        idempotency_key: idem,
      },
    };
  }

  const destRail = stringField((destination as any).payment_rail).toLowerCase();
  const payoutRails = new Set(["ach", "wire", "sepa", "faster_payments"]);
  const externalAccountId = stringField(
    (destination as any).external_account_id,
  );
  if (!payoutRails.has(destRail) || !externalAccountId) {
    return invalid(
      "payouts require an approved fiat rail and destination.external_account_id",
      {
        field: "destination.external_account_id",
      },
    );
  }
  if (!VA_FIAT_CURRENCIES.has(destCurrency)) {
    return invalid("payout destination.currency must be USD|EUR|GBP", {
      field: "destination.currency",
    });
  }
  return {
    ok: true,
    value: {
      source: {
        payment_rail: "bridge_wallet",
        currency: sourceCurrency,
        amount,
        bridge_wallet_id: sourceWalletId,
      },
      destination: {
        payment_rail: destRail as "ach" | "wire" | "sepa" | "faster_payments",
        currency: destCurrency,
        external_account_id: externalAccountId,
      },
      idempotency_key: idem,
    },
  };
}

export type WebhookCreateInput = {
  endpoint_url: string;
};

export function validateWebhookCreate(
  body: any,
): ValidationResult<WebhookCreateInput> {
  const endpoint = stringField(body?.endpoint_url);
  if (!endpoint) {
    return invalid("endpoint_url is required", { field: "endpoint_url" });
  }
  try {
    return {
      ok: true,
      value: { endpoint_url: validateApiWebhookEndpointUrl(endpoint) },
    };
  } catch (error) {
    return invalid(
      error instanceof ApiWebhookSecurityError
        ? error.message
        : "endpoint_url must be a valid HTTPS URL",
      {
      field: "endpoint_url",
      },
    );
  }
}

export function validateIdempotencyHeader(
  value: string | null,
): ValidationResult<string> {
  const key = stringField(value);
  if (!key) {
    return invalid("Idempotency-Key header is required", {
      field: "Idempotency-Key",
    });
  }
  if (key.length < 8 || key.length > 256) {
    return invalid("Idempotency-Key must be between 8 and 256 chars", {
      field: "Idempotency-Key",
    });
  }
  return { ok: true, value: key };
}
import {
  ApiWebhookSecurityError,
  validateApiWebhookEndpointUrl,
} from "./api-webhook-security.ts";
