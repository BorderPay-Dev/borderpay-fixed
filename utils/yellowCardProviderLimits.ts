export type YellowCardProviderDirection = 'receive' | 'payout';
export type YellowCardProviderRail = 'bank' | 'mobile_money';
export type YellowCardProviderBounds = {
  minimum: number | null;
  maximum: number | null;
  source: 'yellow_card_api_snapshot_2026-08-12';
};

// Manual, synchronous fallback copied from Yellow Card's active sandbox
// /channels response on 2026-08-12. These are transaction limits, not the
// minimum/maximum fee columns in the signed pricing PDF.
const LIMITS: Record<string, Omit<YellowCardProviderBounds, 'source'>> = {
  'NG|NGN|bank|payout': { minimum: 1800, maximum: 30000000 },
  'NG|NGN|bank|receive': { minimum: 2500, maximum: 5000000 },
  'CG|XAF|bank|payout': { minimum: 1000, maximum: 50000000 },
  'CG|XAF|bank|receive': { minimum: 1000, maximum: 50000000 },
  'CI|XOF|mobile_money|payout': { minimum: 500, maximum: 1500000 },
  'CI|XOF|mobile_money|receive': { minimum: 500, maximum: 1500000 },
  'CI|XOF|bank|payout': { minimum: 500, maximum: null },
  'CI|XOF|bank|receive': { minimum: 500, maximum: null },
  'RW|RWF|mobile_money|payout': { minimum: 1500, maximum: null },
  'RW|RWF|mobile_money|receive': { minimum: 1500, maximum: null },
  'RW|RWF|bank|payout': { minimum: 1500, maximum: null },
  'RW|RWF|bank|receive': { minimum: 1500, maximum: null },
  'KE|KES|mobile_money|payout': { minimum: 150, maximum: 250000 },
  'KE|KES|mobile_money|receive': { minimum: 150, maximum: 250000 },
  'KE|KES|bank|payout': { minimum: 500, maximum: 999999 },
  'KE|KES|bank|receive': { minimum: 300, maximum: null },
  'ZA|ZAR|bank|payout': { minimum: 200, maximum: 500000 },
  'ZA|ZAR|bank|receive': { minimum: 100, maximum: null },
  'CM|XAF|mobile_money|payout': { minimum: 1000, maximum: null },
  'CM|XAF|mobile_money|receive': { minimum: 1000, maximum: 1000000 },
  'CM|XAF|bank|payout': { minimum: 1000, maximum: 1000000 },
  'CM|XAF|bank|receive': { minimum: 1000, maximum: null },
  'ZM|ZMW|mobile_money|payout': { minimum: 100, maximum: 500000 },
  'ZM|ZMW|mobile_money|receive': { minimum: null, maximum: 100000 },
  'ZM|ZMW|bank|payout': { minimum: 100, maximum: 15000000 },
  'ZM|ZMW|bank|receive': { minimum: 100, maximum: 15000000 },
  'UG|UGX|mobile_money|payout': { minimum: 15000, maximum: null },
  'UG|UGX|mobile_money|receive': { minimum: 15000, maximum: null },
  'UG|UGX|bank|payout': { minimum: 15000, maximum: null },
  'UG|UGX|bank|receive': { minimum: 15000, maximum: null },
  'TZ|TZS|mobile_money|payout': { minimum: 2500, maximum: 10000000 },
  'TZ|TZS|mobile_money|receive': { minimum: 2500, maximum: null },
  'TZ|TZS|bank|payout': { minimum: 2500, maximum: null },
  'TZ|TZS|bank|receive': { minimum: 2500, maximum: null },
  'BW|BWP|mobile_money|payout': { minimum: 150, maximum: 9500 },
  'BW|BWP|mobile_money|receive': { minimum: 150, maximum: 9500 },
  'BW|BWP|bank|payout': { minimum: 150, maximum: 1000000 },
  'BW|BWP|bank|receive': { minimum: 150, maximum: null },
  'BJ|XOF|mobile_money|payout': { minimum: 500, maximum: 1500000 },
  'BJ|XOF|mobile_money|receive': { minimum: 500, maximum: 1500000 },
};

export function yellowCardProviderBounds(
  country: string,
  currency: string,
  channel: YellowCardProviderRail,
  direction: YellowCardProviderDirection,
): YellowCardProviderBounds | null {
  const row = LIMITS[`${country.trim().toUpperCase()}|${currency.trim().toUpperCase()}|${channel}|${direction}`];
  return row ? { ...row, source: 'yellow_card_api_snapshot_2026-08-12' } : null;
}
