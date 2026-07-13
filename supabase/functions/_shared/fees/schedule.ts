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
 *       • Virtual-account on-ramp developer fee: 2.5%
 *       • External-account fiat off-ramp developer fee: 1.0%
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
  virtual_account_fiat:      2.5,
  external_account_offramp:  1.0,
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
 * BorderPay's fixed markup (percent) on the African payout leg, by plan.
 *   • Starter:        individual 1.0% / business 0.75%
 *   • Premium/Growth: 0.5%
 *   • Enterprise:     0.5% (lowest tier by default; revisit per-contract)
 */
export const AFRICAN_PAYOUT_MARKUP_PERCENT_BY_PLAN: Record<FeePlanKey, number> = {
  individual_starter:  1.0,
  individual_premium:  0.5,
  business_starter:    0.75,
  business_growth:     0.5,
  business_enterprise: 0.5,
};

/** Lowest-tier markup used as the safe default when a plan key is unknown. */
export const AFRICAN_PAYOUT_MARKUP_DEFAULT_PERCENT = 0.5;

/**
 * Resolve the Bridge developer-fee percent for a known product path.
 */
export function bridgeDeveloperFeePercent(
  paymentRail: string | null | undefined,
  _currency: string | null | undefined,
): number {
  const rail = String(paymentRail ?? "").toLowerCase();
  if (rail === "external_account_offramp") return BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp;
  return BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat;
}

/**
 * BorderPay African payout markup percent for a subscription plan. Falls back
 * to the lowest tier (0.5%) for unknown / missing plan keys — fail-cheap, we
 * never accidentally over-charge by defaulting high.
 */
export function africanPayoutMarkupPercent(planKey: string | null | undefined): number {
  const k = String(planKey ?? "") as FeePlanKey;
  return AFRICAN_PAYOUT_MARKUP_PERCENT_BY_PLAN[k] ?? AFRICAN_PAYOUT_MARKUP_DEFAULT_PERCENT;
}
