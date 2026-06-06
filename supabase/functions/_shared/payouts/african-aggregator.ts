/**
 * Localized African aggregator — PLACEHOLDER module (#B1/#B2).
 *
 * Interface for African-corridor payouts (bank account + mobile money). NO real
 * partner is integrated yet, so executeAfricanPayout fails closed with
 * `no_partner` — it makes NO external network call. When a partner is signed,
 * implement the request/response mapping here behind this same interface; the
 * corridor router and fee engine already feed it.
 */

export type AfricanPayoutMethod = "bank_account" | "mobile_money";

export interface AfricanBankDestination {
  account_number: string;
  bank_code:      string;
}

export interface AfricanMobileMoneyDestination {
  phone:   string;
  network: string; // e.g. MPESA, MTN, AIRTEL, etc.
}

export interface AfricanPayoutRequest {
  country:          string;            // ISO-3166 alpha-2
  currency:         string;            // local currency, e.g. NGN/KES/GHS
  amount:           string;            // decimal string
  method:           AfricanPayoutMethod;
  bank?:            AfricanBankDestination;
  mobile?:          AfricanMobileMoneyDestination;
  idempotency_key:  string;
}

export interface AfricanPayoutResult {
  ok:         boolean;
  code?:      string;
  error?:     string;
  payout_id?: string;
}

/**
 * PLACEHOLDER executor. Fails closed (no partner, no network call) until a real
 * local aggregator is integrated. Validates only the shape so callers can wire
 * the form/router today.
 */
export async function executeAfricanPayout(req: AfricanPayoutRequest): Promise<AfricanPayoutResult> {
  if (req.method === "bank_account" && (!req.bank?.account_number || !req.bank?.bank_code)) {
    return { ok: false, code: "invalid_destination", error: "Bank account number and bank code are required." };
  }
  if (req.method === "mobile_money" && (!req.mobile?.phone || !req.mobile?.network)) {
    return { ok: false, code: "invalid_destination", error: "Mobile number and network provider are required." };
  }
  // No partner yet — never call out, never move money.
  return { ok: false, code: "no_partner", error: "Local payout is not available in your region yet." };
}
