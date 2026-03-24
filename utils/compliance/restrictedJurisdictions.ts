/**
 * BorderPay Africa - Restricted Jurisdictions
 * Compliance list of countries where we cannot provide services
 * 
 * Updated regularly based on regulatory and partner requirements
 * 
 * Restrictions:
 * - Cannot onboard entities located in these jurisdictions
 * - Cannot onboard entities with UBOs in these jurisdictions
 * - Cannot send or receive funds from these jurisdictions
 */

export interface RestrictedCountry {
  code: string;
  name: string;
  reason?: string;
}

export const RESTRICTED_JURISDICTIONS: RestrictedCountry[] = [
  { code: 'AB', name: 'Abkhazia', reason: 'Disputed territory' },
  { code: 'AF', name: 'Afghanistan', reason: 'Sanctions' },
  { code: 'AL', name: 'Albania', reason: 'Regulatory restrictions' },
  { code: 'AO', name: 'Angola', reason: 'Regulatory restrictions' },
  { code: 'BY', name: 'Belarus', reason: 'Sanctions' },
  { code: 'BA', name: 'Bosnia and Herzegovina', reason: 'Regulatory restrictions' },
  { code: 'MM', name: 'Burma (Myanmar)', reason: 'Sanctions' },
  { code: 'BI', name: 'Burundi', reason: 'Sanctions' },
  { code: 'CF', name: 'Central African Republic', reason: 'Sanctions' },
  { code: 'CU', name: 'Cuba', reason: 'Sanctions' },
  { code: 'KP', name: 'Democratic People\'s Republic of Korea (North Korea)', reason: 'Sanctions' },
  { code: 'CD', name: 'Democratic Republic of the Congo', reason: 'Sanctions' },
  { code: 'ET', name: 'Ethiopia', reason: 'Regulatory restrictions' },
  { code: 'ER', name: 'Eritrea', reason: 'Sanctions' },
  { code: 'GN', name: 'Guinea', reason: 'Regulatory restrictions' },
  { code: 'GW', name: 'Guinea-Bissau', reason: 'Regulatory restrictions' },
  { code: 'HT', name: 'Haiti', reason: 'Regulatory restrictions' },
  { code: 'IR', name: 'Iran', reason: 'Sanctions' },
  { code: 'IQ', name: 'Iraq', reason: 'Sanctions' },
  { code: 'CI', name: 'Ivory Coast (Cote D\'Ivoire)', reason: 'Regulatory restrictions' },
  { code: 'XK', name: 'Kosovo', reason: 'Disputed territory' },
  { code: 'LB', name: 'Lebanon', reason: 'Regulatory restrictions' },
  { code: 'LR', name: 'Liberia', reason: 'Regulatory restrictions' },
  { code: 'LY', name: 'Libya', reason: 'Sanctions' },
  { code: 'MK', name: 'Macedonia', reason: 'Regulatory restrictions' },
  { code: 'ML', name: 'Mali', reason: 'Sanctions' },
  { code: 'NK', name: 'Nagorno-Karabakh', reason: 'Disputed territory' },
  { code: 'NI', name: 'Nicaragua', reason: 'Sanctions' },
  { code: 'NC', name: 'Northern Cyprus', reason: 'Disputed territory' },
  { code: 'PK', name: 'Pakistan', reason: 'Regulatory restrictions' },
  { code: 'RU', name: 'Russia', reason: 'Sanctions' },
  { code: 'EH', name: 'Sahrawi Arab Democratic Republic', reason: 'Disputed territory' },
  { code: 'SO', name: 'Somalia', reason: 'Sanctions' },
  { code: 'SL', name: 'Somaliland', reason: 'Disputed territory' },
  { code: 'OS', name: 'South Ossetia', reason: 'Disputed territory' },
  { code: 'SS', name: 'South Sudan', reason: 'Sanctions' },
  { code: 'SD', name: 'Sudan', reason: 'Sanctions' },
  { code: 'SY', name: 'Syria', reason: 'Sanctions' },
  { code: 'RS', name: 'Serbia', reason: 'Regulatory restrictions' },
  { code: 'SL', name: 'Sierra Leone', reason: 'Regulatory restrictions' },
  { code: 'UA', name: 'Ukraine', reason: 'Regulatory restrictions' },
  { code: 'VE', name: 'Venezuela', reason: 'Sanctions' },
  { code: 'YE', name: 'Yemen', reason: 'Sanctions' },
  { code: 'ZW', name: 'Zimbabwe', reason: 'Sanctions' },
];

// Quick lookup map for performance
export const RESTRICTED_COUNTRY_CODES = new Set(
  RESTRICTED_JURISDICTIONS.map(country => country.code)
);


/**
 * Check if a country code is restricted
 */
export function isCountryRestricted(countryCode: string): boolean {
  return RESTRICTED_COUNTRY_CODES.has(countryCode.toUpperCase());
}

/**
 * Get restriction reason for a country
 */
export function getRestrictionReason(countryCode: string): string | null {
  const country = RESTRICTED_JURISDICTIONS.find(
    c => c.code === countryCode.toUpperCase()
  );
  return country?.reason || null;
}

/**
 * Validate if user can onboard from their location
 */
export interface OnboardingValidation {
  allowed: boolean;
  reason?: string;
  countryName?: string;
}

export function validateOnboarding(countryCode: string): OnboardingValidation {
  const restricted = RESTRICTED_JURISDICTIONS.find(
    c => c.code === countryCode.toUpperCase()
  );

  if (restricted) {
    return {
      allowed: false,
      reason: restricted.reason || 'This jurisdiction is restricted',
      countryName: restricted.name,
    };
  }

  return { allowed: true };
}

