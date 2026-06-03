/**
 * BorderPay Africa - Card Country Eligibility
 * Countries where future card access is not currently eligible
 * 
 * IMPORTANT: This is separate from account signup restrictions
 * - Users CAN create accounts from some of these countries
 * - Card access remains locked until BorderPay enables cards
 * - Country eligibility is shown only when that product is enabled
 * 
 * Compliance: OFAC, UN Security Council, EU Sanctions, and country rules
 */

export interface CardRestrictedCountry {
  code: string;
  name: string;
  reason: string;
  category: 'geographic_sanctions' | 'card_network_restriction' | 'financial_sanctions';
}

/**
 * Countries where future card access is not currently eligible
 * Based on sanctions, compliance, and country rules
 */
export const CARD_RESTRICTED_COUNTRIES: CardRestrictedCountry[] = [
  // North Africa
  { code: 'DZ', name: 'Algeria', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'LY', name: 'Libya', reason: 'UN Security Council sanctions', category: 'geographic_sanctions' },
  { code: 'SD', name: 'Sudan', reason: 'US sanctions', category: 'geographic_sanctions' },
  
  // West Africa
  { code: 'GM', name: 'Gambia (The)', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'LR', name: 'Liberia', reason: 'Financial sanctions', category: 'financial_sanctions' },
  { code: 'TG', name: 'Togo', reason: 'Country rules', category: 'geographic_sanctions' },
  
  // Central Africa
  { code: 'CF', name: 'Central African Republic', reason: 'UN sanctions', category: 'geographic_sanctions' },
  { code: 'CG', name: 'Congo (The Republic of)', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'CD', name: 'Congo (The Democratic Republic of the)', reason: 'UN sanctions', category: 'geographic_sanctions' },
  
  // East Africa
  { code: 'BI', name: 'Burundi', reason: 'EU sanctions', category: 'geographic_sanctions' },
  { code: 'KM', name: 'Comoros', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'SO', name: 'Somalia', reason: 'UN sanctions', category: 'geographic_sanctions' },
  { code: 'SS', name: 'South Sudan', reason: 'UN sanctions', category: 'geographic_sanctions' },
  
  // Southern Africa
  { code: 'ZW', name: 'Zimbabwe', reason: 'US and EU sanctions', category: 'geographic_sanctions' },
  
  // Middle East
  { code: 'AF', name: 'Afghanistan', reason: 'US sanctions', category: 'geographic_sanctions' },
  { code: 'IR', name: 'Iran (Islamic Republic of)', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'IQ', name: 'Iraq', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'LB', name: 'Lebanon', reason: 'Financial sanctions', category: 'financial_sanctions' },
  { code: 'PS', name: 'Palestine', reason: 'Country rules', category: 'card_network_restriction' },
  { code: 'SY', name: 'Syrian Arab Republic', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'YE', name: 'Yemen (Republic of)', reason: 'UN sanctions', category: 'geographic_sanctions' },
  
  // Asia
  { code: 'KP', name: 'Korea (The Democratic People\'s Republic of, North)', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'MM', name: 'Myanmar', reason: 'US sanctions', category: 'geographic_sanctions' },
  { code: 'MV', name: 'Maldives', reason: 'Country rules', category: 'geographic_sanctions' },
  
  // Central Asia
  { code: 'KG', name: 'Kyrgyzstan (AKA Kyrgyz Republic)', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'TJ', name: 'Tajikistan', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'TM', name: 'Turkmenistan', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'UZ', name: 'Uzbekistan', reason: 'Country rules', category: 'geographic_sanctions' },
  
  // Europe
  { code: 'BY', name: 'Belarus', reason: 'EU and US sanctions', category: 'geographic_sanctions' },
  { code: 'RS', name: 'Serbia', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'RU', name: 'Russian Federation', reason: 'OFAC and EU sanctions', category: 'geographic_sanctions' },
  { code: 'UA', name: 'Ukraine', reason: 'Country rules', category: 'card_network_restriction' },
  
  // Americas
  { code: 'CU', name: 'Cuba', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'NI', name: 'Nicaragua', reason: 'US sanctions', category: 'geographic_sanctions' },
  { code: 'SR', name: 'Suriname', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'VE', name: 'Venezuela (Bolivarian Republic of)', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  
  // Territories & Dependencies
  { code: 'SJ', name: 'Svalbard and Jan Mayen', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'TK', name: 'Tokelau', reason: 'Country rules', category: 'geographic_sanctions' },
  { code: 'WF', name: 'Wallis and Futuna', reason: 'Country rules', category: 'geographic_sanctions' },
];

/**
 * Get all card-restricted country codes
 */
export const CARD_RESTRICTED_COUNTRY_CODES = CARD_RESTRICTED_COUNTRIES.map(c => c.code);

/**
 * Check if a country is card-restricted
 */
export function isCardRestricted(countryCode: string): boolean {
  return CARD_RESTRICTED_COUNTRY_CODES.includes(countryCode.toUpperCase());
}

/**
 * Get card restriction details for a country
 */
export function getCardRestrictionDetails(countryCode: string): CardRestrictedCountry | null {
  const country = CARD_RESTRICTED_COUNTRIES.find(
    c => c.code === countryCode.toUpperCase()
  );
  return country || null;
}

/**
 * Get all card-restricted countries by category
 */
export function getCardRestrictedByCategory(
  category: 'geographic_sanctions' | 'card_network_restriction' | 'financial_sanctions'
): CardRestrictedCountry[] {
  return CARD_RESTRICTED_COUNTRIES.filter(c => c.category === category);
}

/**
 * Validate card usage for a country
 * Returns { allowed: boolean, reason?: string }
 */
export function validateCardUsage(countryCode: string): {
  allowed: boolean;
  reason?: string;
  category?: string;
} {
  const restriction = getCardRestrictionDetails(countryCode);
  
  if (restriction) {
    return {
      allowed: false,
      reason: restriction.reason,
      category: restriction.category,
    };
  }
  
  return { allowed: true };
}

/**
 * Get user-friendly message for card restriction
 */
export function getCardRestrictionMessage(countryCode: string): string {
  const restriction = getCardRestrictionDetails(countryCode);
  
  if (!restriction) {
    return 'Card access is locked. Country availability will be shown when cards are enabled.';
  }
  
  const messages: Record<CardRestrictedCountry['category'], string> = {
    geographic_sanctions: `Card access is locked. ${restriction.name} is not eligible under current country rules.`,
    card_network_restriction: `Card access is locked. ${restriction.name} is not eligible under current country rules.`,
    financial_sanctions: `Card access is locked. ${restriction.name} is not eligible under current country rules.`,
  };
  
  return messages[restriction.category];
}

/**
 * Statistics about card country eligibility
 */
export function getCardRestrictionStats() {
  const total = CARD_RESTRICTED_COUNTRIES.length;
  const bySanctions = getCardRestrictedByCategory('geographic_sanctions').length;
  const byCardNetwork = getCardRestrictedByCategory('card_network_restriction').length;
  const byFinancial = getCardRestrictedByCategory('financial_sanctions').length;
  
  return {
    total,
    geographic_sanctions: bySanctions,
    card_network_restriction: byCardNetwork,
    financial_sanctions: byFinancial,
  };
}
