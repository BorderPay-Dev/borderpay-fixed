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
 * See the edge module's header for the full semantics of fee layers. Do not
 * treat fixed trade rates as developer fees.
 */

/** Bridge developer-fee percentages. Bridge deducts these from transfers. */
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

/**
 * African payout markup by ACCOUNT TYPE (current model — flat, plan-independent,
 * retained for compatibility with older access rows):
 *   • Individual: 0.75%
 *   • Business:   0.50%
 * Stacked on the raw local-currency settlement (pass-through) cost.
 */
export const AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT: Record<'individual' | 'business', number> = {
  individual: 0.75,
  business:   0.50,
};

export function africanRailMarkupPercentForAccount(accountType: string | null | undefined): number {
  return String(accountType ?? '').toLowerCase() === 'business'
    ? AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT.business
    : AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT.individual;
}

export const AFRICAN_PAYOUT_MARKUP_PERCENT_BY_ACCOUNT = AFRICAN_RAIL_MARKUP_PERCENT_BY_ACCOUNT;
export const africanPayoutMarkupPercentForAccount = africanRailMarkupPercentForAccount;

/** Resolve the Bridge developer-fee percent for a known product path. */
export function bridgeDeveloperFeePercent(
  paymentRail: string | null | undefined,
  _currency: string | null | undefined,
  accountType?: string | null | undefined,
): number {
  const rail = String(paymentRail ?? '').toLowerCase();
  if (rail === 'external_account_offramp') return BRIDGE_DEVELOPER_FEE_PERCENT.external_account_offramp;
  if (rail === 'crypto_to_crypto_route') return BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_route;
  if (rail === 'crypto_to_crypto_payout') return BRIDGE_DEVELOPER_FEE_PERCENT.crypto_to_crypto_payout;
  return String(accountType ?? '').toLowerCase() === 'business'
    ? BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_business
    : BRIDGE_DEVELOPER_FEE_PERCENT.virtual_account_fiat_individual;
}

/** BorderPay African payout markup percent for a subscription plan. */
export function africanPayoutMarkupPercent(planKey: string | null | undefined): number {
  const k = String(planKey ?? '') as FeePlanKey;
  return AFRICAN_PAYOUT_MARKUP_PERCENT_BY_PLAN[k] ?? AFRICAN_PAYOUT_MARKUP_DEFAULT_PERCENT;
}
