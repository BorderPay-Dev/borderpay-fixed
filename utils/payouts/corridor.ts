/**
 * Frontend corridor classifier (checkout) — mirror of the backend
 * supabase/functions/_shared/payouts/corridor-router.ts. Used by the checkout
 * to pick the fee tier (international vs African) for display. Kept byte-for-byte
 * in sync with the backend African set by payout_corridor_fee_engine_audit.py.
 */

export type Corridor = 'international' | 'african';

/** ISO-3166 alpha-2 codes routed through the localized African aggregator. */
export const AFRICAN_PAYOUT_COUNTRIES: ReadonlySet<string> = new Set([
  'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CG', 'CD',
  'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE',
  'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG',
  'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG',
  'ZM', 'ZW',
]);

export function classifyCorridor(country: string | null | undefined): Corridor {
  return AFRICAN_PAYOUT_COUNTRIES.has(String(country ?? '').trim().toUpperCase())
    ? 'african'
    : 'international';
}
