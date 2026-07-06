export type BorderPayMode = "sandbox" | "production";

export type BorderPayErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "idempotency_key_required"
  | "idempotency_replay_mismatch"
  | "not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "internal_error";

export interface BorderPayErrorEnvelope {
  success: false;
  error: {
    code: BorderPayErrorCode;
    message: string;
    details?: Record<string, unknown> | null;
  };
}

export interface BorderPaySuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface BorderPayGatewayHealth {
  request_id: string;
  route: string;
  tenant_id: string;
  tenant_name: string;
  mode: BorderPayMode;
  rate_limit_per_minute: number;
  remaining: number;
  reset_at: string;
  gateway: string;
}

export type AccountType = "individual" | "business";

export interface CreateCustomerRequest {
  account_type: AccountType;
  email: string;
  country_code: string;
  full_name?: string;
  company_name?: string;
  registration_number?: string;
  phone_e164?: string;
  borderpay_user_id: string;
}

export interface CreateCustomerResponseData {
  customer_id: string;
  provider: "borderpay";
}

export interface CreateWalletRequest {
  customer_id: string;
  symbol: "USDC" | "USDT" | "PYUSD" | "USDB" | "EURC";
  chain: "ETH" | "SOL" | "BSC" | "POLYGON" | "TRON" | "BASE" | "OPTIMISM" | "ARBITRUM";
}

export interface CreateWalletResponseData {
  wallet_id: string;
  deposit_address: string;
  symbol: string;
  chain: string;
}

export interface CreateVirtualAccountRequest {
  customer_id: string;
  currency: "USD" | "EUR" | "GBP";
  destination: {
    rail: string;
    currency: string;
    address: string;
  };
}

export interface CreateVirtualAccountResponseData {
  virtual_account_id: string;
  currency: string;
  account_number?: string | null;
  routing_number?: string | null;
  iban?: string | null;
  bic?: string | null;
  bank_name?: string | null;
}

export interface TransferParty {
  payment_rail: string;
  currency: string;
  chain?: string;
  amount?: string;
  customer_id?: string;
  from_address?: string;
  address?: string;
  bridge_wallet_id?: string;
  external_account_id?: string;
  deposit_id?: string;
  bank_account?: {
    account_number?: string;
    routing_number?: string;
    iban?: string;
    bic?: string;
  };
}

export interface CreateTransferRequest {
  source: TransferParty;
  destination: TransferParty;
  developer_fee?: {
    percentage?: number;
    flat_amount?: string;
  };
  idempotency_key: string;
}

export interface CreateTransferResponseData {
  transfer_id: string;
  state: string;
  provider: "borderpay";
}

export interface CreateWebhookRequest {
  endpoint_url: string;
}

export interface CreateWebhookResponseData {
  webhook_id: string;
  endpoint_url: string;
  signing_secret: string;
  created_at: string;
}
