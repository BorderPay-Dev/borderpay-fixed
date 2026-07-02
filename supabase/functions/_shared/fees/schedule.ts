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

/**
 * Transfer flat-fee policy (USD) by source amount band.
 *
 * This fee is sent to Bridge as `developer_fee_amount` (flat amount) in
 * addition to `developer_fee_percent`, for non-flexible transfer flows.
 *
 * IMPORTANT:
 * - This policy is only applied on USD-denominated transfer sources
 *   (USD / USDC / USDT) so "$ flat fee" semantics remain
 *   deterministic.
 * - For non-USD currencies, we keep percent-only developer fee.
 */
export const BRIDGE_TRANSFER_FLAT_FEE_USD_BANDS: ReadonlyArray<{
  minInclusive: number;
  upToInclusive: number;
  flatUsd: number;
}> = [
  { minInclusive: 10,    upToInclusive: 100,   flatUsd: 1.00 },  // $10–$100
  { minInclusive: 101,   upToInclusive: 499,   flatUsd: 5.00 },  // $101–$499
  { minInclusive: 500,   upToInclusive: 999,   flatUsd: 10.00 }, // $500–$999
  { minInclusive: 1000,  upToInclusive: 2000,  flatUsd: 20.00 }, // $1000–$2000
  { minInclusive: 2001,  upToInclusive: 2999,  flatUsd: 25.00 }, // $2001–$2999
  { minInclusive: 3000,  upToInclusive: 5000,  flatUsd: 50.00 }, // $3000–$5000
  { minInclusive: 5001,  upToInclusive: 9999,  flatUsd: 100.00 }, // $5001–$9999
  { minInclusive: 10000, upToInclusive: 20000, flatUsd: 200.00 }, // $10000–$20000
] as const;

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
  "USDC", "USDT",
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

/** Whether the source currency is USD-denominated for flat-$ policy usage. */
export function isUsdDenominatedCurrency(currency: string | null | undefined): boolean {
  const c = String(currency ?? "").toUpperCase();
  return c === "USD" || c === "USDC" || c === "USDT";
}

/**
 * Resolve flat transfer developer fee amount (USD) by source amount.
 * Returns:
 * - 2dp decimal string for Bridge `developer_fee_amount` when amount is in-band
 * - undefined when amount is below minimum configured threshold ($10)
 */
export function bridgeTransferFlatFeeAmountUsd(sourceAmount: number): string | undefined {
  const safe = Number.isFinite(sourceAmount) && sourceAmount > 0 ? sourceAmount : 0;
  const band = BRIDGE_TRANSFER_FLAT_FEE_USD_BANDS.find((b) =>
    safe >= b.minInclusive && safe <= b.upToInclusive
  );
  if (!band) return undefined;
  return band.flatUsd.toFixed(2);
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
