/**
 * BorderPay Africa — canonical fee schedule (SERVER / edge authority).
 *
 * This is the single source of truth for money math that is ENFORCED
 * server-side. The frontend mirror lives in `utils/fees/schedule.ts` and
 * `tests/audit/borderpay_fee_schedule_audit.py` asserts the two carry the
 * exact same numbers, so what we display can never drift from what the
 * server actually charges.
 *
 * Two distinct fee layers — do not conflate them:
 *
 *  1. BRIDGE DEVELOPER FEE — Bridge takes it OUT OF the transfer (its
 *     native `developer_fee_percent`; deducted from the sent amount, NOT
 *     added on top of what the user is charged). Applied AUTOMATICALLY on
 *     every transfer, computed server-side, never trusted from the client:
 *       • Fiat rail (ach / wire / sepa):  2.5%
 *       • Stablecoin rail (USDT/USDC/…):  0.999%  (fixed trade rate)
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

/** Bridge developer-fee percentages by source rail. Bridge deducts these. */
export const BRIDGE_DEVELOPER_FEE_PERCENT = {
  fiat:       2.5,
  stablecoin: 0.999,  // fixed trade rate
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

const STABLECOIN_SYMBOLS: ReadonlySet<string> = new Set([
  "USDC", "USDT", "PYUSD", "USDB", "EURC",
]);

/**
 * Resolve the automatic Bridge developer-fee percent for a transfer's source
 * rail. Stablecoin (rail === "stablecoin" or a stablecoin currency symbol) is
 * the fixed 0.99%; everything else (fiat rails) is 2.5%.
 */
export function bridgeDeveloperFeePercent(
  paymentRail: string | null | undefined,
  currency: string | null | undefined,
): number {
  const rail = String(paymentRail ?? "").toLowerCase();
  const cur  = String(currency ?? "").toUpperCase();
  const isStablecoin = rail === "stablecoin" || STABLECOIN_SYMBOLS.has(cur);
  return isStablecoin
    ? BRIDGE_DEVELOPER_FEE_PERCENT.stablecoin
    : BRIDGE_DEVELOPER_FEE_PERCENT.fiat;
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
