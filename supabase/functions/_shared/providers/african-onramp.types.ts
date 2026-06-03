/**
 * African local-rails adapter — future interface stub.
 *
 * This file defines the contract a future African local-rails adapter must
 * implement so it can plug straight into our orchestration layer.
 *
 * BorderPay's flow (once a partner is live):
 *
 *   user → stablecoin wallet → local-rails adapter → KES/NGN/GHS/UGX/TZS/XOF/CDF →
 *          mobile wallet OR local bank
 *
 * Until local rails are enabled: the orchestration layer in `bridge-transfer`
 * detects that the destination currency is in `AFRICAN_RAMP_CURRENCIES`,
 * and returns `{ supported: false, reason: 'no_partner' }`. The frontend
 * surfaces "Coming soon for KES/NGN/…".
 */

import type {
  StablecoinSymbol, StablecoinChain,
} from "./types.ts";

export const AFRICAN_RAMP_CURRENCIES = [
  "NGN", "KES", "GHS", "UGX", "TZS", "RWF",
  "XAF", "XOF", "CDF", "ZAR", "MZN", "ETB",
] as const;
export type AfricanRampCurrency = typeof AFRICAN_RAMP_CURRENCIES[number];

export type AfricanPayoutMethod =
  | { kind: "mobile_money"; provider: string;  phone_e164: string; account_name?: string }
  | { kind: "bank_transfer"; bank_code: string; account_number: string; account_name: string };

export interface OnRampQuoteInput {
  source_currency:  AfricanRampCurrency;        // user pays in this
  source_amount:    string;                     // decimal as string
  destination_symbol: StablecoinSymbol;         // e.g. USDC
  destination_chain:  StablecoinChain;
}

export interface OffRampQuoteInput {
  source_symbol:    StablecoinSymbol;
  source_chain:     StablecoinChain;
  source_amount:    string;
  destination_currency: AfricanRampCurrency;
  destination_country:  string;                 // ISO-3166 alpha-2
}

export interface RampQuote {
  quote_id:         string;
  rate:             string;                     // "1500.50" (decimal)
  fee:              string;                     // partner fee
  expires_at:       string;
  estimated_arrival_seconds: number;
}

export interface OffRampExecuteInput {
  quote_id:    string;
  customer_id: string;                          // partner-side
  source: {                                     // already-locked stablecoin source
    chain:        StablecoinChain;
    symbol:       StablecoinSymbol;
    tx_hash?:     string;                       // if user broadcast themselves
    sender_addr?: string;
  };
  destination: AfricanPayoutMethod;
  user_metadata?: Record<string, unknown>;
}

export interface OffRampExecuteResult {
  partner_transaction_id: string;
  state:    "pending" | "processing" | "succeeded" | "failed";
  raw:      unknown;
}

/** The contract a partner adapter implements. */
export interface AfricanOnOffRampProvider {
  readonly name:        string;             // 'pawapay', 'flutterwave', 'kotani', etc.
  readonly currencies:  AfricanRampCurrency[];
  readonly methods:     ("mobile_money" | "bank_transfer")[];

  quoteOnRamp(input: OnRampQuoteInput):  Promise<RampQuote>;
  quoteOffRamp(input: OffRampQuoteInput): Promise<RampQuote>;

  executeOffRamp(input: OffRampExecuteInput): Promise<OffRampExecuteResult>;

  /** Webhook signature verification, partner-specific. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<boolean>;
}
