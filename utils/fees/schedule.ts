/**
 * BorderPay Africa — fee schedule (FRONTEND mirror, display authority).
 *
 * Mirror of the server-authoritative schedule at
 * `supabase/functions/_shared/fees/schedule.ts`. The frontend uses these for
 * fee disclosure / quote previews ONLY — the server is what actually charges.
 * `tests/audit/borderpay_fee_schedule_audit.py` asserts the numbers here are
 * byte-identical to the edge module so the displayed fee can never drift from
 * the enforced fee.
 *
 * See the edge module's header for the full semantics of the two fee layers
 * (Bridge developer fee vs African payout markup).
 */

/** Bridge developer-fee percentages by source rail. Bridge deducts these. */
export const BRIDGE_DEVELOPER_FEE_PERCENT = {
  fiat:       2.5,
  stablecoin: 0.999,  // fixed trade rate
} as const;

export type FeePlanKey =
  | 'individual_starter'
  | 'individual_premium'
  | 'business_starter'
  | 'business_growth'
  | 'business_enterprise';

/** BorderPay's fixed markup (percent) on the African payout leg, by plan. */
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
  'USDC', 'USDT', 'PYUSD', 'USDB', 'EURC',
]);

/** Resolve the automatic Bridge developer-fee percent for a source rail. */
export function bridgeDeveloperFeePercent(
  paymentRail: string | null | undefined,
  currency: string | null | undefined,
): number {
  const rail = String(paymentRail ?? '').toLowerCase();
  const cur  = String(currency ?? '').toUpperCase();
  const isStablecoin = rail === 'stablecoin' || STABLECOIN_SYMBOLS.has(cur);
  return isStablecoin
    ? BRIDGE_DEVELOPER_FEE_PERCENT.stablecoin
    : BRIDGE_DEVELOPER_FEE_PERCENT.fiat;
}

/** BorderPay African payout markup percent for a subscription plan. */
export function africanPayoutMarkupPercent(planKey: string | null | undefined): number {
  const k = String(planKey ?? '') as FeePlanKey;
  return AFRICAN_PAYOUT_MARKUP_PERCENT_BY_PLAN[k] ?? AFRICAN_PAYOUT_MARKUP_DEFAULT_PERCENT;
}
