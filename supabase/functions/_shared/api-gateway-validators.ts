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
const SOURCE_RAILS = new Set([
  "stablecoin",
  "ach",
  "wire",
  "sepa",
  "bridge_wallet",
  "external_account",
]);
const DEST_RAILS = new Set([
  "stablecoin",
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
    rail: string;
    currency: string;
    address: string;
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
  const rail = stringField(destination?.rail);
  if (!rail) {
    return invalid("destination.rail is required", {
      field: "destination.rail",
    });
  }

  const dcy = stringField(destination?.currency);
  if (!dcy) {
    return invalid("destination.currency is required", {
      field: "destination.currency",
    });
  }

  const address = stringField(destination?.address);
  if (!address) {
    return invalid("destination.address is required", {
      field: "destination.address",
    });
  }

  return {
    ok: true,
    value: {
      customer_id: customerId,
      currency: currency as "USD" | "EUR" | "GBP",
      destination: {
        rail,
        currency: dcy,
        address,
      },
    },
  };
}

export type TransferInput = {
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
  developer_fee?: Record<string, unknown>;
  idempotency_key: string;
};

export function validateTransferOrPayout(
  body: any,
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

  const sourceRail = stringField((source as any).payment_rail).toLowerCase();
  if (!SOURCE_RAILS.has(sourceRail)) {
    return invalid("source.payment_rail unsupported", {
      field: "source.payment_rail",
      allowed: Array.from(SOURCE_RAILS),
    });
  }

  const destRail = stringField((destination as any).payment_rail).toLowerCase();
  if (!DEST_RAILS.has(destRail)) {
    return invalid("destination.payment_rail unsupported", {
      field: "destination.payment_rail",
      allowed: Array.from(DEST_RAILS),
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
  if (!sourceCurrency) {
    return invalid("source.currency is required", { field: "source.currency" });
  }
  if (!destCurrency) {
    return invalid("destination.currency is required", {
      field: "destination.currency",
    });
  }

  if (sourceRail === "stablecoin") {
    const chain = stringField((source as any).chain).toUpperCase();
    if (!chain) {
      return invalid("source.chain required for stablecoin source", {
        field: "source.chain",
      });
    }
  }

  if (destRail === "stablecoin") {
    const chain = stringField((destination as any).chain).toUpperCase();
    if (!chain) {
      return invalid("destination.chain required for stablecoin destination", {
        field: "destination.chain",
      });
    }
    const toAddress = stringField(
      (destination as any).address || (destination as any).to_address,
    );
    if (!toAddress) {
      return invalid(
        "destination.address required for stablecoin destination",
        {
          field: "destination.address",
        },
      );
    }
  }

  return {
    ok: true,
    value: {
      source,
      destination,
      developer_fee: typeof transfer?.developer_fee === "object"
        ? transfer.developer_fee
        : undefined,
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
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return invalid("endpoint_url must be a valid URL", {
      field: "endpoint_url",
    });
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return invalid("endpoint_url must use http or https", {
      field: "endpoint_url",
    });
  }
  return { ok: true, value: { endpoint_url: endpoint } };
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
