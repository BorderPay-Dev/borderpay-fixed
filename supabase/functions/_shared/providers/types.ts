/**
 * Bridge provider contract.
 * Bridge is the only supported provider for runtime financial operations.
 */

export type ProviderName = "bridge";
export type AccountType  = "individual" | "business";
export type FiatCurrency = "USD" | "EUR" | "GBP" | "NGN" | "KES" | "GHS" | "UGX" | "TZS" | "XAF" | "XOF" | "ZAR";
export type StablecoinSymbol = "USDC" | "USDT" | "PYUSD" | "USDB" | "EURC";
export type StablecoinChain  = "ETH" | "SOL" | "BSC" | "POLYGON" | "TRON" | "BASE" | "OPTIMISM" | "ARBITRUM";
export type BridgePaymentRail =
  | "ach"
  | "wire"
  | "sepa"
  | "mobile_money"
  | "local_bank"
  | "bridge_wallet"
  | "external_account"
  | "tron"
  | "base"
  | "ethereum"
  | "solana"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "avalanche_c_chain"
  | "celo"
  | "stellar";

export interface CustomerCreateInput {
  account_type:        AccountType;
  email:               string;
  full_name?:          string;
  // Business
  company_name?:       string;
  registration_number?:string;
  // Address
  country_code:        string;       // ISO-3166 alpha-2
  phone_e164?:         string;
  // Optional metadata for provider routing
  borderpay_user_id:   string;       // our internal user id
}

export interface CustomerCreateResult {
  provider:        ProviderName;
  provider_id:     string;           // Bridge customer id (today, the only active provider)
  raw:             unknown;          // provider's full response, for forensics
}

export interface KycLinkInput {
  // Bridge's `/v0/kyc_links` accepts either an existing customer_id OR the
  // user's basic info (full_name + email + type), in which case Bridge
  // creates the customer when the user completes the hosted flow. We
  // strongly prefer the second mode because it avoids the strict
  // pre-validation that `/v0/customers` requires (signed_agreement_id,
  // birth_date, full address) — those are collected on the hosted page.
  customer_id?:      string;
  full_name?:        string;
  company_name?:     string;
  email?:            string;
  account_type:      AccountType;
  redirect_url?:     string;          // where Bridge sends user post-flow
  endorsements?:     ("base"|"sepa"|"spei"|"crypto")[];
}

export interface KycLinkResult {
  provider:    ProviderName;
  link_id:     string;
  link_url:    string;                // hosted URL to send user to
  expires_at?: string;
  raw:         unknown;
}

export interface VirtualAccountCreateInput {
  customer_id:    string;
  currency:       Extract<FiatCurrency, "USD" | "EUR" | "GBP">;
  // REQUIRED by the provider: where incoming fiat auto-converts to. The stablecoin
  // address + the blockchain rail it settles on. `rail` is a Bridge-canonical
  // chain string (e.g. "solana", "ethereum", "polygon", "tron", "base").
  destination:    {
    rail?:           string;
    payment_rail?:   string;
    currency:        string;          // stablecoin symbol e.g. "usdc" | "usdt"
    address:         string;          // the wallet address to receive at
  };
  developer_fee_percent?: string;
  allow_zero_developer_fee?: boolean;
  idempotency_key?: string;
}

/** A provider wallet as returned by GET /v0/customers/{id}/wallets. */
export interface ProviderWalletSummary {
  wallet_id: string; currency: string; chain: string; address: string; balance?: string;
}
/** A provider virtual account as returned by GET /v0/customers/{id}/virtual_accounts. */
export interface ProviderVirtualAccountSummary {
  virtual_account_id: string; currency: string; rail?: string; status?: string; account_details: unknown;
}

export interface VirtualAccountResult {
  provider:           ProviderName;
  virtual_account_id: string;
  account_number?:    string;
  routing_number?:    string;
  iban?:              string;
  bic?:               string;
  bank_name?:         string;
  currency:           FiatCurrency;
  raw:                unknown;
}

export interface WalletCreateInput {
  customer_id:  string;
  symbol:       StablecoinSymbol;
  chain:        StablecoinChain;
}

export interface WalletResult {
  provider:        ProviderName;
  wallet_id:       string;
  deposit_address: string;
  symbol:          StablecoinSymbol;
  chain:           StablecoinChain;
  raw:             unknown;
}

export interface TransferCreateInput {
  on_behalf_of?: string;
  source: {
    customer_id?:   string;
    payment_rail:   BridgePaymentRail;
    currency:       StablecoinSymbol | FiatCurrency;
    chain?:         StablecoinChain;
    amount?:        string;            // decimal as string; omitted for static-template/flexible routes
    from_address?:  string;
    bridge_wallet_id?: string;
    external_account_id?: string;
  };
  destination: {
    payment_rail:   BridgePaymentRail;
    currency:       StablecoinSymbol | FiatCurrency;
    chain?:         StablecoinChain;
    address?:       string;            // crypto address
    bridge_wallet_id?: string;
    external_account_id?: string;
    deposit_id?:    string;
    bank_account?:  { account_number: string; routing_number?: string; iban?: string; bic?: string };
    mobile_money?:  { provider: string; phone: string };  // future
  };
  developer_fee?:  { percentage?: number; flat_amount?: string };
  features?: {
    static_template?: boolean;
    flexible_amount?: boolean;
    allow_any_from_address?: boolean;
  };
  idempotency_key: string;
}

export interface TransferResult {
  provider:     ProviderName;
  transfer_id:  string;
  state:        string;              // raw provider state (preserved)
  raw:          unknown;
}

export interface LiquidationAddressCreateInput {
  customer_id: string;
  currency: StablecoinSymbol;
  chain: BridgePaymentRail;
  destination_payment_rail: BridgePaymentRail;
  destination_currency: StablecoinSymbol;
  destination_address: string;
  return_address: string;
  developer_fee_percent?: string;
  idempotency_key: string;
}

export interface LiquidationAddressResult {
  provider: ProviderName;
  liquidation_address_id: string;
  address: string;
  state: string;
  raw: unknown;
}

/**
 * The contract.
 */
export interface PaymentProvider {
  readonly name: ProviderName;

  // Identity
  createCustomer(input: CustomerCreateInput): Promise<CustomerCreateResult>;

  // Onboarding
  createKycLink(input: KycLinkInput): Promise<KycLinkResult>;

  // Accounts
  createVirtualAccount(input: VirtualAccountCreateInput): Promise<VirtualAccountResult>;

  // Wallets
  createWallet(input: WalletCreateInput): Promise<WalletResult>;

  // Money movement
  createTransfer(input: TransferCreateInput): Promise<TransferResult>;

  // Permanent crypto route address.
  createLiquidationAddress(input: LiquidationAddressCreateInput): Promise<LiquidationAddressResult>;
}

/** Webhook signature verification — provider-specific. */
export interface WebhookVerifier {
  /** Returns true if (rawBody, headers) is authentic. */
  verify(rawBody: string, headers: Record<string, string>): Promise<boolean>;
}
