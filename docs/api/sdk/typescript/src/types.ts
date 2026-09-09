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
    payment_rail: "base" | "tron";
    currency: "USDC" | "USDT";
    bridge_wallet_id: string;
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

export interface BridgeWalletSource {
  payment_rail: "bridge_wallet";
  currency: "USDC" | "USDT";
  amount: string;
  bridge_wallet_id: string;
}

export interface CreateTransferRequest {
  source: BridgeWalletSource;
  destination: {
    payment_rail: "bridge_wallet";
    currency: "USDC" | "USDT";
    bridge_wallet_id: string;
  };
  idempotency_key: string;
}

export interface CreatePayoutRequest {
  source: BridgeWalletSource;
  destination: {
    payment_rail: "ach" | "wire" | "sepa" | "faster_payments";
    currency: "USD" | "EUR" | "GBP";
    external_account_id: string;
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
