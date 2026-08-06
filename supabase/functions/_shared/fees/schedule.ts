/**
 * BorderPay Africa — canonical fee schedule (SERVER / edge authority).
 *
 * This is the single source of truth for money math that is ENFORCED
 * server-side. The frontend mirror lives in `utils/fees/schedule.ts` and
 * `tests/audit/borderpay_fee_schedule_audit.py` asserts the two carry the
 * exact same numbers, so what we display can never drift from what the
 * server actually charges.
 *
 * Fee layers — do not conflate them:
 *
 *  1. BRIDGE DEVELOPER FEE — Bridge takes it OUT OF the transfer (its
 *     native `developer_fee_percent`; deducted from the sent amount, never
 *     trusted from the client:
 *       • Virtual-account on-ramp developer fee:
 *         - Individual: 2.5%
 *         - Business:   2.0%
 *       • External-account fiat off-ramp developer fee: 1.0%
 *       • Crypto-to-crypto saved route developer fee: 1.0%
 *       • Same-token crypto external-wallet payout: 0.0%
 *         Bridge rejects developer_fee on USDC->USDC / USDT->USDT wallet payouts.
 *
 *     Bridge fixed trade rates, e.g. USDT 0.999, are NOT developer fees.
 *
 *  2. AFRICAN PAYOUT MARKUP — BorderPay's fixed markup added on top of
 *     whatever African payout partner we route the local-currency leg
 *     through, tiered by subscription plan. Separate from the Bridge
 *     developer fee above.
 *
 *     NOTE: African-currency payout EXECUTION is still gated behind a partner
 *     integration — `bridge-transfer` returns `no_partner` (503) today — so
 *     this table is the canonical definition the payout path will consume
 *     once a partner lands. It does not move money on its own.
 */

/** Bridge developer-fee percentages. Bridge deducts these. */
export const BRIDGE_DEVELOPER_FEE_PERCENT = {
  virtual_account_fiat_individual: 2.5,
  virtual_account_fiat_business:   2.0,
  external_account_offramp:        1.0,
  crypto_to_crypto_route:          1.0,
  crypto_to_crypto_payout:         0.0,
} as const;

/** Bridge fixed trade-rate config. This is NOT a developer fee. */
export const BRIDGE_FIXED_TRADE_RATE = {
  USDT: 0.999,
} as const;

export type FeePlanKey =
  | "individual_starter"
  | "individual_premium"
  | "business_starter"
  | "business_growth"
  | "business_enterprise";

/**
 * BorderPay's fixed markup (percent) on the African payout leg, by legacy key.
 */
export const AFRICAN_PAYOUT_MARKUP_PERCENT_BY_PLAN: Record<FeePlanKey, number> = {
  individual_starter:  1.0,
  individual_premium:  1.0,
  business_starter:    1.0,
  business_growth:     1.0,
  business_enterprise: 1.0,
};

/** Unified Yellow Card markup used when a plan key is unknown. */
export const AFRICAN_PAYOUT_MARKUP_DEFAULT_PERCENT = 1.0;

/** BorderPay markup on Yellow Card Send and Receive rails. */
export const AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT: Record<"individual" | "business", number> = {
  individual: 1.0,
  business: 1.0,
};

export function africanRailMarkupPercentForAccount(accountType: string | null | undefined): number {
  return String(accountType ?? "").toLowerCase() === "business"
    ? AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT.business
    : AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT.individual;
}

/**
 * Resolve the Bridge developer-fee percent for a known product path.
 */
export function bridgeDeveloperFeePercent(
  paymentRail: string | null | undefined,
  _currency: string | null | undefined,
  accountType?: string | null | undefined,
): number {
  const rail = String(paymentRail ?? "").toLowerCase();
  if (rail === "external_account_offramp") return BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp;
  if (rail === "crypto_to_crypto_route") return BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_route;
  if (rail === "crypto_to_crypto_payout") return BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_payout;
  return String(accountType ?? "").toLowerCase() === "business"
    ? BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_business
    : BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_individual;
}

/**
 * BorderPay African payout markup percent for a subscription plan. Falls back
 * to the unified 1% Yellow Card markup for unknown / missing plan keys.
 */
export function africanPayoutMarkupPercent(planKey: string | null | undefined): number {
  const k = String(planKey ?? "") as FeePlanKey;
  return AFRICAN_PAYOUT_MARKUP_PERCENT_BY_PLAN[k] ?? AFRICAN_PAYOUT_MARKUP_DEFAULT_PERCENT;
}
