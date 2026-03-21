/**
 * BorderPay Africa - Card-Restricted Countries
 * Countries where virtual cards CANNOT be used due to geographic sanctions
 * 
 * IMPORTANT: This is separate from account signup restrictions
 * - Users CAN create accounts from some of these countries
 * - Users CANNOT use virtual cards while in these countries
 * - Cards will be declined if used in these jurisdictions
 * 
 * Compliance: OFAC, UN Security Council, EU Sanctions, Card Network Rules
 */

export interface CardRestrictedCountry {
  code: string;
  name: string;
  reason: string;
  category: 'geographic_sanctions' | 'card_network_restriction' | 'financial_sanctions';
}

/**
 * Countries where card usage is restricted
 * Based on Visa/Mastercard sanctions and geographic restrictions
 */
export const CARD_RESTRICTED_COUNTRIES: CardRestrictedCountry[] = [
  // North Africa
  { code: 'DZ', name: 'Algeria', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'LY', name: 'Libya', reason: 'UN Security Council sanctions', category: 'geographic_sanctions' },
  { code: 'SD', name: 'Sudan', reason: 'US sanctions', category: 'geographic_sanctions' },
  
  // West Africa
  { code: 'GM', name: 'Gambia (The)', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'LR', name: 'Liberia', reason: 'Financial sanctions', category: 'financial_sanctions' },
  { code: 'TG', name: 'Togo', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  
  // Central Africa
  { code: 'CF', name: 'Central African Republic', reason: 'UN sanctions', category: 'geographic_sanctions' },
  { code: 'CG', name: 'Congo (The Republic of)', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'CD', name: 'Congo (The Democratic Republic of the)', reason: 'UN sanctions', category: 'geographic_sanctions' },
  
  // East Africa
  { code: 'BI', name: 'Burundi', reason: 'EU sanctions', category: 'geographic_sanctions' },
  { code: 'KM', name: 'Comoros', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'SO', name: 'Somalia', reason: 'UN sanctions', category: 'geographic_sanctions' },
  { code: 'SS', name: 'South Sudan', reason: 'UN sanctions', category: 'geographic_sanctions' },
  
  // Southern Africa
  { code: 'ZW', name: 'Zimbabwe', reason: 'US and EU sanctions', category: 'geographic_sanctions' },
  
  // Middle East
  { code: 'AF', name: 'Afghanistan', reason: 'US sanctions', category: 'geographic_sanctions' },
  { code: 'IR', name: 'Iran (Islamic Republic of)', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'IQ', name: 'Iraq', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'LB', name: 'Lebanon', reason: 'Financial sanctions', category: 'financial_sanctions' },
  { code: 'PS', name: 'Palestine', reason: 'Card network restrictions', category: 'card_network_restriction' },
  { code: 'SY', name: 'Syrian Arab Republic', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'YE', name: 'Yemen (Republic of)', reason: 'UN sanctions', category: 'geographic_sanctions' },
  
  // Asia
  { code: 'KP', name: 'Korea (The Democratic People\'s Republic of, North)', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'MM', name: 'Myanmar', reason: 'US sanctions', category: 'geographic_sanctions' },
  { code: 'MV', name: 'Maldives', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  
  // Central Asia
  { code: 'KG', name: 'Kyrgyzstan (AKA Kyrgyz Republic)', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'TJ', name: 'Tajikistan', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'TM', name: 'Turkmenistan', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'UZ', name: 'Uzbekistan', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  
  // Europe
  { code: 'BY', name: 'Belarus', reason: 'EU and US sanctions', category: 'geographic_sanctions' },
  { code: 'RS', name: 'Serbia', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'RU', name: 'Russian Federation', reason: 'OFAC and EU sanctions', category: 'geographic_sanctions' },
  { code: 'UA', name: 'Ukraine', reason: 'Card network restrictions (conflict zones)', category: 'card_network_restriction' },
  
  // Americas
  { code: 'CU', name: 'Cuba', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  { code: 'NI', name: 'Nicaragua', reason: 'US sanctions', category: 'geographic_sanctions' },
  { code: 'SR', name: 'Suriname', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'VE', name: 'Venezuela (Bolivarian Republic of)', reason: 'OFAC sanctions', category: 'geographic_sanctions' },
  
  // Territories & Dependencies
  { code: 'SJ', name: 'Svalbard and Jan Mayen', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'TK', name: 'Tokelau', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
  { code: 'WF', name: 'Wallis and Futuna', reason: 'Geographic sanctions', category: 'geographic_sanctions' },
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
    return 'Card usage is allowed in this country.';
  }
  
  const messages: Record<CardRestrictedCountry['category'], string> = {
    geographic_sanctions: `Virtual cards cannot be used in ${restriction.name} due to international geographic sanctions. This restriction is enforced by Visa and Mastercard card networks.`,
    card_network_restriction: `Virtual cards cannot be used in ${restriction.name} due to card network restrictions. Visa and Mastercard have temporarily suspended services in this region.`,
    financial_sanctions: `Virtual cards cannot be used in ${restriction.name} due to financial sanctions. Transactions in this jurisdiction are prohibited by international compliance regulations.`,
  };
  
  return messages[restriction.category];
}

/**
 * Statistics about card restrictions
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
