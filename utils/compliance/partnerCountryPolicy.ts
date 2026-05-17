/**
 * Frontend mirror of the partner country eligibility policy.
 *
 * The server-side authority lives in
 * `supabase/functions/_shared/providers/bridge-country-policy.ts` and is
 * consulted by every partner-facing edge function. The frontend cannot
 * import server modules, so this file restates the same data for UI rendering
 * (Geographic restrictions screen, country pickers, KYC pre-checks).
 *
 * Update both files in lockstep when adding or removing a country.
 *
 * Categories surfaced to users:
 *   • coming-soon    → partner does not support; we will onboard via a
 *                      future local-rails partner. Signup IS allowed; only
 *                      partner-backed financial products are blocked.
 *   • partner-only   → partner supports; this is the live tier today.
 */

export type PartnerCountryStatus = 'coming-soon' | 'partner-only';

export interface PartnerCountryEntry {
  code:    string;                      // ISO-3166 alpha-2
  name:    string;
  status:  PartnerCountryStatus;
  reason?: string;
}

/** ISO-3166 alpha-2 codes blocked from partner customer creation today. */
export const COMING_SOON_COUNTRIES: readonly PartnerCountryEntry[] = [
  {
    code:   'CD',
    name:   'Democratic Republic of the Congo',
    status: 'coming-soon',
    reason: 'Our verification partner does not yet support DRC residents. We are bringing it online via our African local-rails partner.',
  },
];

const COMING_SOON_SET = new Set(COMING_SOON_COUNTRIES.map(c => c.code));

export function isComingSoon(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return COMING_SOON_SET.has(countryCode.toUpperCase());
}

export function partnerCountryEntry(countryCode: string | null | undefined): PartnerCountryEntry | null {
  if (!countryCode) return null;
  const upper = countryCode.toUpperCase();
  return COMING_SOON_COUNTRIES.find(c => c.code === upper) ?? null;
}
