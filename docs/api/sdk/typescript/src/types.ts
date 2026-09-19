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

/** Customer data is recorded by hosted onboarding. This resumes that customer's verification. */
export interface CreateCustomerRequest {
  customer_id?: string;
}
export interface CreateCustomerResponseData {
  customer_id: string | null;
  account_type: AccountType;
  link_url?: string;
  tos_link_url?: string;
  already_approved?: boolean;
}

export interface CreateWalletRequest {
  customer_id?: string;
  symbol: "USDC" | "USDT" | "EURC";
  chain: "TRON" | "BASE";
}

export interface CreateWalletResponseData {
  wallet_id: string;
  deposit_address: string;
  symbol: string;
  chain: string;
}

export interface CreateVirtualAccountRequest {
  customer_id?: string;
  currency: "USD" | "EUR" | "GBP";
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
  payment_rail:
    | "bridge_wallet"
    | "base"
    | "tron"
    | "ach"
    | "wire"
    | "sepa"
    | "faster_payments";
  currency: "USDC" | "USDT" | "EURC" | "USD" | "EUR" | "GBP";
  amount?: string;
  bridge_wallet_id?: string;
  external_account_id?: string;
  external_wallet_id?: string;
  address?: string;
}
export interface CreateTransferRequest {
  source: TransferParty;
  destination: TransferParty;
  idempotency_key?: string;
  sca_authorization_id?: string;
  /** Non-EEA API payouts use the customer's transaction PIN, without TOTP. */
  transaction_pin?: string;
}

export interface CreateTransferResponseData {
  transfer_id: string;
  state: string;
  provider_state?: string;
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
