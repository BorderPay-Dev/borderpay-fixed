/**
 * BorderPay Africa commercial local-rail pricing.
 *
 * Source of truth: 2026 commercial pricing PDFs provided by BorderPay.
 * This module is deliberately not wired into execution yet. It is the reviewed
 * fee/routing contract that the YC/FW execution layer must satisfy before any
 * live local African rail launch.
 */

export type AfricaRailProvider = 'yellow_card' | 'flutterwave';
export type AfricaDirection = 'collection' | 'payout';
export type AfricaRail = 'mobile_money' | 'local_bank';
export type FeeShape = 'percent_only' | 'fixed_only' | 'percent_plus_fixed' | 'percent_with_minmax' | 'tiered';

export interface AfricaCommercialRoute {
  country: string;
  iso2: string;
  currency: string;
  direction: AfricaDirection;
  rail: AfricaRail;
  provider: AfricaRailProvider;
  providerFee: string;
  borderpayCustomerFee: string;
  feeShape: FeeShape;
  enabled: boolean;
  notes?: string;
}

const ROUTES = [
  ['Benin', 'BJ', 'XOF', 'collection', 'mobile_money', 'yellow_card', '2.22%', '3.50%', 'percent_only'],
  ['Benin', 'BJ', 'XOF', 'payout', 'mobile_money', 'yellow_card', '1.82%', '2.75%', 'percent_only'],
  ['Botswana', 'BW', 'BWP', 'collection', 'local_bank', 'yellow_card', '0.25% / 300 BWP tier', '2.50% / 500 BWP tier', 'tiered'],
  ['Botswana', 'BW', 'BWP', 'collection', 'mobile_money', 'yellow_card', '2.55%', '3.75%', 'percent_only'],
  ['Botswana', 'BW', 'BWP', 'payout', 'local_bank', 'yellow_card', '0.25% / 300 BWP tier', '2.00% / 500 BWP tier', 'tiered'],
  ['Botswana', 'BW', 'BWP', 'payout', 'mobile_money', 'yellow_card', '1.50%', '2.75%', 'percent_only'],
  ['Burkina Faso', 'BF', 'XOF', 'collection', 'mobile_money', 'yellow_card', '2.52%', '3.75%', 'percent_only'],
  ['Burkina Faso', 'BF', 'XOF', 'payout', 'mobile_money', 'yellow_card', '1.82%', '2.75%', 'percent_only'],
  ['Cameroon', 'CM', 'XAF', 'collection', 'mobile_money', 'yellow_card', '1.82%', '3.00%', 'percent_only'],
  ['Cameroon', 'CM', 'XAF', 'payout', 'mobile_money', 'flutterwave', '1.00%', '2.50%', 'percent_only'],
  ['Cameroon', 'CM', 'XAF', 'payout', 'local_bank', 'flutterwave', '1,500 XAF', '2,500 XAF', 'fixed_only'],
  ['Central Africa Republic', 'CF', 'XAF', 'payout', 'local_bank', 'flutterwave', '1,500 XAF', '2,500 XAF', 'fixed_only', false, 'Payout-only corridor.'],
  ['Chad', 'TD', 'XAF', 'collection', 'mobile_money', 'yellow_card', '3.22%', '4.50%', 'percent_only'],
  ['Chad', 'TD', 'XAF', 'payout', 'mobile_money', 'yellow_card', '656 XAF minimum', '2.75%, min 1,000 XAF', 'percent_with_minmax'],
  ['Chad', 'TD', 'XAF', 'payout', 'local_bank', 'flutterwave', '1,500 XAF', '2,500 XAF', 'fixed_only'],
  ['Congo Brazzaville', 'CG', 'XAF', 'collection', 'mobile_money', 'yellow_card', '3.22%', '4.50%', 'percent_only'],
  ['Congo Brazzaville', 'CG', 'XAF', 'payout', 'mobile_money', 'yellow_card', '656 XAF minimum', '2.75%, min 1,000 XAF', 'percent_with_minmax'],
  ['DR Congo', 'CD', 'CDF', 'payout', 'mobile_money', 'yellow_card', '0.75%, min 1 CDF', '2.50%, min 1 CDF', 'percent_with_minmax', false, 'Payout-only corridor; no customer onboarding/collection.'],
  ['Egypt', 'EG', 'EGP', 'collection', 'local_bank', 'flutterwave', '2.00% + 2.50 EGP', '3.50% + 5.00 EGP', 'percent_plus_fixed'],
  ['Egypt', 'EG', 'EGP', 'payout', 'local_bank', 'flutterwave', '1.00%, min 20 EGP, cap 25 EGP', '2.50%, min 25 EGP, cap 35 EGP', 'percent_with_minmax'],
  ['Ethiopia', 'ET', 'USD', 'payout', 'local_bank', 'yellow_card', '0.25%, min 20 USD', '2.00%, min 20 USD', 'percent_with_minmax', false, 'USD bank payout only.'],
  ['Gabon', 'GA', 'XAF', 'collection', 'local_bank', 'yellow_card', '2.00% or 1,000 XAF tier', '3.25% or 1,500 XAF tier', 'tiered'],
  ['Gabon', 'GA', 'XAF', 'collection', 'mobile_money', 'yellow_card', '3.22%', '4.50%', 'percent_only'],
  ['Gabon', 'GA', 'XAF', 'payout', 'local_bank', 'flutterwave', '1,500 XAF', '2,500 XAF', 'fixed_only'],
  ['Gabon', 'GA', 'XAF', 'payout', 'mobile_money', 'yellow_card', '2.52%', '3.75%', 'percent_only'],
  ['Ghana', 'GH', 'GHS', 'collection', 'mobile_money', 'flutterwave', '2.00%', '3.50%', 'percent_only'],
  ['Ghana', 'GH', 'GHS', 'collection', 'local_bank', 'flutterwave', '2.00%', '3.50%', 'percent_only'],
  ['Ghana', 'GH', 'GHS', 'payout', 'local_bank', 'flutterwave', '10 GHS', '20 GHS', 'fixed_only'],
  ['Ghana', 'GH', 'GHS', 'payout', 'mobile_money', 'flutterwave', '1.50%', '2.75%', 'percent_only'],
  ['Ivory Coast', 'CI', 'XOF', 'collection', 'mobile_money', 'yellow_card', '2.22%', '3.50%', 'percent_only'],
  ['Ivory Coast', 'CI', 'XOF', 'payout', 'mobile_money', 'yellow_card', '1.82%', '2.75%', 'percent_only'],
  ['Ivory Coast', 'CI', 'XOF', 'payout', 'local_bank', 'flutterwave', '1,500 XOF up to 49.9M; 4,000 XOF 50M+', '2,500 XOF up to 49.9M; 6,000 XOF 50M+', 'tiered'],
  ['Kenya', 'KE', 'KES', 'collection', 'mobile_money', 'yellow_card', '0.77%', '2.50%', 'percent_only'],
  ['Kenya', 'KE', 'KES', 'collection', 'local_bank', 'yellow_card', '1.00%', '2.75%', 'percent_only'],
  ['Kenya', 'KE', 'KES', 'payout', 'mobile_money', 'flutterwave', '100 KES', '200 KES', 'fixed_only'],
  ['Kenya', 'KE', 'KES', 'payout', 'local_bank', 'flutterwave', '100 KES', '200 KES', 'fixed_only'],
  ['Malawi', 'MW', 'MWK', 'collection', 'local_bank', 'yellow_card', '0.25% / 1,000 MWK tier', '2.50% / 1,500 MWK tier', 'tiered'],
  ['Malawi', 'MW', 'MWK', 'collection', 'mobile_money', 'flutterwave', '1,000 MWK up to 30k; 2.50% above', '2,000 MWK up to 30k; 3.50% above', 'tiered'],
  ['Malawi', 'MW', 'MWK', 'payout', 'local_bank', 'yellow_card', '0.25% / 1,000 MWK tier', '2.25% / 1,500 MWK tier', 'tiered'],
  ['Malawi', 'MW', 'MWK', 'payout', 'mobile_money', 'yellow_card', '2.50%, min 100 MWK', '3.50%, min 500 MWK', 'percent_with_minmax'],
  ['Mali', 'ML', 'XOF', 'collection', 'mobile_money', 'yellow_card', '2.22%', '3.50%', 'percent_only'],
  ['Mali', 'ML', 'XOF', 'payout', 'mobile_money', 'yellow_card', '2.02%', '3.25%', 'percent_only'],
  ['Nigeria', 'NG', 'NGN', 'collection', 'local_bank', 'yellow_card', '0.89%, min 100 NGN', '2.75%, min 100 NGN', 'percent_with_minmax'],
  ['Nigeria', 'NG', 'NGN', 'payout', 'local_bank', 'flutterwave', '10/25/50 NGN tiers', '30/75/150 NGN tiers', 'tiered'],
  ['Rwanda', 'RW', 'RWF', 'collection', 'local_bank', 'yellow_card', '1.00%', '2.75%', 'percent_only'],
  ['Rwanda', 'RW', 'RWF', 'collection', 'mobile_money', 'yellow_card', '3.02%', '4.25%', 'percent_only'],
  ['Rwanda', 'RW', 'RWF', 'payout', 'local_bank', 'flutterwave', '2,000 RWF', '3,000 RWF', 'fixed_only'],
  ['Rwanda', 'RW', 'RWF', 'payout', 'mobile_money', 'flutterwave', '500 RWF', '1,000 RWF', 'fixed_only'],
  ['Senegal', 'SN', 'XOF', 'collection', 'mobile_money', 'flutterwave', '2.00%', '3.50%', 'percent_only'],
  ['Senegal', 'SN', 'XOF', 'payout', 'mobile_money', 'yellow_card', '1.82%, min 1 XOF', '2.75%, min 1 XOF', 'percent_with_minmax'],
  ['Senegal', 'SN', 'XOF', 'payout', 'local_bank', 'flutterwave', '1,500 XOF', '2,500 XOF', 'fixed_only'],
  ['South Africa', 'ZA', 'ZAR', 'collection', 'local_bank', 'yellow_card', '0.97%', '2.75%', 'percent_only'],
  ['South Africa', 'ZA', 'ZAR', 'payout', 'local_bank', 'flutterwave', '10 ZAR', '20 ZAR', 'fixed_only'],
  ['Tanzania', 'TZ', 'TZS', 'collection', 'local_bank', 'yellow_card', '0.50% / 0.25% tier', '2.50%', 'tiered'],
  ['Tanzania', 'TZ', 'TZS', 'collection', 'mobile_money', 'yellow_card', '1.50% below 300k; 1.00% 300k+', '2.75%', 'tiered'],
  ['Tanzania', 'TZ', 'TZS', 'payout', 'local_bank', 'flutterwave', '3,000 TZS', '5,000 TZS', 'fixed_only'],
  ['Tanzania', 'TZ', 'TZS', 'payout', 'mobile_money', 'flutterwave', '500 TZS below 40k; 1.50% 40k+', '1,000 TZS below 40k; 2.75% 40k+', 'tiered'],
  ['Togo', 'TG', 'XOF', 'collection', 'mobile_money', 'yellow_card', '4.22%', '5.25%', 'percent_only'],
  ['Togo', 'TG', 'XOF', 'payout', 'mobile_money', 'yellow_card', '1.82%', '2.75%', 'percent_only'],
  ['Uganda', 'UG', 'UGX', 'collection', 'local_bank', 'yellow_card', '1.00% / 35k UGX tier', '2.75% / 50k UGX tier', 'tiered'],
  ['Uganda', 'UG', 'UGX', 'collection', 'mobile_money', 'yellow_card', '2.50%', '3.75%', 'percent_only'],
  ['Uganda', 'UG', 'UGX', 'payout', 'local_bank', 'flutterwave', '5,000 UGX', '8,000 UGX', 'fixed_only'],
  ['Uganda', 'UG', 'UGX', 'payout', 'mobile_money', 'flutterwave', '1,000 UGX below 125k; 1.20% 125k+', '2,000 UGX below 125k; 2.25% 125k+', 'tiered'],
  ['Zambia', 'ZM', 'ZMW', 'collection', 'local_bank', 'yellow_card', '0.25% / 150 ZMW tier', '2.50% / 250 ZMW tier', 'tiered'],
  ['Zambia', 'ZM', 'ZMW', 'collection', 'mobile_money', 'yellow_card', '2.22%', '3.50%', 'percent_only'],
  ['Zambia', 'ZM', 'ZMW', 'payout', 'local_bank', 'yellow_card', '0.50% / 0.25% tier', '2.00%', 'tiered'],
  ['Zambia', 'ZM', 'ZMW', 'payout', 'mobile_money', 'yellow_card', '35 ZMW', '70 ZMW', 'fixed_only'],
] as const;

export const AFRICA_COMMERCIAL_FEE_ROUTES: AfricaCommercialRoute[] = ROUTES.map((row) => ({
  country: row[0],
  iso2: row[1],
  currency: row[2],
  direction: row[3] as AfricaDirection,
  rail: row[4] as AfricaRail,
  provider: row[5] as AfricaRailProvider,
  providerFee: row[6],
  borderpayCustomerFee: row[7],
  feeShape: row[8] as FeeShape,
  enabled: typeof row[9] === 'boolean' ? row[9] : true,
  notes: typeof row[10] === 'string' ? row[10] : undefined,
}));

function feeLooksFixed(fee: string): boolean {
  return /\b(?:XAF|XOF|KES|NGN|GHS|RWF|TZS|UGX|ZAR|EGP|ZMW|MWK|BWP|USD|CDF)\b/i.test(fee);
}

export function validateAfricaCommercialFeeRoute(route: AfricaCommercialRoute): string[] {
  const errors: string[] = [];
  const customerHasFixed = feeLooksFixed(route.borderpayCustomerFee);
  const providerHasFixed = feeLooksFixed(route.providerFee);

  if (customerHasFixed && !providerHasFixed) {
    errors.push(`${route.country} ${route.direction} ${route.rail}: BorderPay fixed fee is only allowed when provider route has a fixed component.`);
  }
  if (providerHasFixed && !customerHasFixed) {
    errors.push(`${route.country} ${route.direction} ${route.rail}: provider fixed fee requires a BorderPay fixed fee rule.`);
  }
  if (!route.borderpayCustomerFee.trim()) {
    errors.push(`${route.country} ${route.direction} ${route.rail}: missing BorderPay customer fee.`);
  }
  if (!route.providerFee.trim()) {
    errors.push(`${route.country} ${route.direction} ${route.rail}: missing provider fee.`);
  }
  if (route.direction === 'collection' && route.iso2 === 'CD') {
    errors.push('DR Congo must remain payout-only.');
  }
  return errors;
}

export function validateAfricaCommercialFeeRoutes(routes = AFRICA_COMMERCIAL_FEE_ROUTES): string[] {
  return routes.flatMap(validateAfricaCommercialFeeRoute);
}

export function africaCommercialRoutesFor(
  direction: AfricaDirection,
  enabledOnly = true,
): AfricaCommercialRoute[] {
  return AFRICA_COMMERCIAL_FEE_ROUTES.filter((route) =>
    route.direction === direction && (!enabledOnly || route.enabled),
  );
}

export function africaCommercialRoutesForCountry(
  direction: AfricaDirection,
  iso2: string,
  enabledOnly = true,
): AfricaCommercialRoute[] {
  const code = String(iso2 || '').toUpperCase();
  return africaCommercialRoutesFor(direction, enabledOnly).filter((route) => route.iso2 === code);
}

export function africaCommercialRouteForRail(
  direction: AfricaDirection,
  iso2: string,
  rail: AfricaRail,
  enabledOnly = true,
): AfricaCommercialRoute | null {
  return africaCommercialRoutesForCountry(direction, iso2, enabledOnly)
    .find((route) => route.rail === rail) || null;
}

export function africaCommercialCountries(direction: AfricaDirection, enabledOnly = true) {
  const byIso = new Map<string, { country: string; iso2: string; currency: string }>();
  for (const route of africaCommercialRoutesFor(direction, enabledOnly)) {
    if (!byIso.has(route.iso2)) {
      byIso.set(route.iso2, {
        country: route.country,
        iso2: route.iso2,
        currency: route.currency,
      });
    }
  }
  return Array.from(byIso.values()).sort((a, b) => a.country.localeCompare(b.country));
}
