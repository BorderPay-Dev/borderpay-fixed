/**
 * Payment Provider Abstraction
 * ───────────────────────────────────────────────────────────────────────────
 * Every external financial-infrastructure provider implements this interface.
 * Edge functions write
 * against the interface, never against a specific provider's API shape, so
 * we can add or swap providers without rewriting business logic.
 *
 * Bridge is the only live provider. `african_onramp` is a future-state
 * placeholder with no live implementation yet. Unknown / removed provider
 * names resolve to Bridge via the registry, never to a legacy provider.
 */

export type ProviderName = "bridge" | "african_onramp";
export type AccountType  = "individual" | "business";
export type FiatCurrency = "USD" | "EUR" | "GBP" | "NGN" | "KES" | "GHS" | "UGX" | "TZS" | "XAF" | "XOF" | "ZAR";
export type StablecoinSymbol = "USDC" | "USDT" | "PYUSD" | "USDB" | "EURC";
export type StablecoinChain  = "ETH" | "SOL" | "BSC" | "POLYGON" | "TRON" | "BASE" | "OPTIMISM" | "ARBITRUM";

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
  destination?:   {
    payment_rail:    "ach"|"sepa"|"swift"|"faster_payments";
    currency:        StablecoinSymbol;
    chain:           StablecoinChain;
    address?:        string;          // wallet to settle into
  };
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
  source: {
    customer_id:    string;
    payment_rail:   "stablecoin" | "ach" | "wire" | "sepa";
    currency:       StablecoinSymbol | FiatCurrency;
    chain?:         StablecoinChain;
    amount:         string;            // decimal as string
  };
  destination: {
    payment_rail:   "stablecoin" | "ach" | "wire" | "sepa" | "mobile_money" | "local_bank";
    currency:       StablecoinSymbol | FiatCurrency;
    chain?:         StablecoinChain;
    address?:       string;            // crypto address
    bank_account?:  { account_number: string; routing_number?: string; iban?: string; bic?: string };
    mobile_money?:  { provider: string; phone: string };  // future
  };
  developer_fee?:  { percentage?: number; flat_amount?: string };
  idempotency_key: string;
}

export interface TransferResult {
  provider:     ProviderName;
  transfer_id:  string;
  state:        "pending" | "processing" | "succeeded" | "failed";
  raw:          unknown;
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
}

/** Webhook signature verification — provider-specific. */
export interface WebhookVerifier {
  /** Returns true if (rawBody, headers) is authentic. */
  verify(rawBody: string, headers: Record<string, string>): Promise<boolean>;
}
