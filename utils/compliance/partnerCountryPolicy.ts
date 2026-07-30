/**
 * Frontend mirror of the Bridge country eligibility policy.
 *
 * The server-side authority lives in
 * `supabase/functions/_shared/providers/bridge-country-policy.ts`.
 * The frontend cannot import server modules directly, so this file
 * restates the same THREE country sets for UI rendering (signup
 * country picker, country eligibility screen, KYC pre-checks).
 *
 * STRICT MIRROR: BRIDGE_PROHIBITED_COUNTRIES,
 * BRIDGE_UNAVAILABLE_COUNTRIES, and BRIDGE_CONTROLLED_COUNTRIES MUST
 * stay byte-identical to the server file. Enforced by
 * `tests/audit/bridge_country_policy_audit.py`. Edit both files in
 * lockstep; the audit script will fail CI if they drift.
 *
 * Four tiers (matches server, round-10):
 *   • Prohibited  → server hard-blocks any Bridge call (sanctions).
 *                   UI: render in the "Restricted" section with
 *                   sanctions language. EXCEPT for DRC, which is the
 *                   single "coming-soon via local rails"
 *                   entry — it is in BRIDGE_PROHIBITED_COUNTRIES at
 *                   the policy level but in COMING_SOON_COUNTRIES at
 *                   the display level.
 *   • Unavailable → server hard-blocks (commercial / regulatory; not
 *                   sanctions). DZ, BI, CN, JP, TN. UI: render in a
 *                   distinct "Not currently serviceable" section,
 *                   "commercial / regulatory restriction, not a
 *                   sanctions designation".
 *   • Controlled  → server does NOT block; emits an observability log.
 *                   UI: signup IS allowed; partner-backed financial
 *                   products carry a "limited support" hint per
 *                   round-9 policy (BorderPay does not yet have Bridge
 *                   approval letters for these jurisdictions).
 *   • Supported   → default-allow; no UI annotation.
 *
 * Source: https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list
 * Captured: 2026-05-21.
 */

/** ISO-3166 alpha-2 codes Bridge classifies as PROHIBITED. */
export const BRIDGE_PROHIBITED_COUNTRIES: ReadonlySet<string> = new Set([
  "AF",   // Afghanistan
  "BY",   // Belarus
  "CD",   // Congo, Democratic Republic (DRC)
  "CU",   // Cuba
  "PS",   // Palestine — covers both Gaza Strip and West Bank
  "IR",   // Iran
  "IQ",   // Iraq
  "LB",   // Lebanon
  "LY",   // Libya
  "MM",   // Myanmar / Burma
  "KP",   // North Korea (DPRK)
  "RU",   // Russian Federation
  "SO",   // Somalia
  "SS",   // South Sudan
  "SD",   // Sudan
  "SY",   // Syria
  "VE",   // Venezuela
  "YE",   // Yemen
  // Note: Bridge ALSO prohibits "Ukrainian Territories" (Crimea,
  // Sevastopol, Donetsk, Kherson, Luhansk, Zaporizhzhia). We only have
  // ISO-2 country granularity, so we cannot enforce sub-nationally.
  // UA-the-country is in Controlled below.
]);

/** ISO-3166 alpha-2 codes Bridge has marked as UNAVAILABLE
 *  (services not facilitated; not sanctions but commercial). */
export const BRIDGE_UNAVAILABLE_COUNTRIES: ReadonlySet<string> = new Set([
  "DZ",   // Algeria
  "BI",   // Burundi
  "CN",   // China
  "JP",   // Japan
  "TN",   // Tunisia
]);

/** ISO-3166 alpha-2 codes Bridge classifies as HIGH RISK / CONTROLLED.
 *  Round-10: DZ, BI, CN moved out into BRIDGE_UNAVAILABLE_COUNTRIES. */
export const BRIDGE_CONTROLLED_COUNTRIES: ReadonlySet<string> = new Set([
  "AX",   // Åland Islands
  "AO",   // Angola
  "AQ",   // Antarctica
  "BD",   // Bangladesh
  "BB",   // Barbados
  "BJ",   // Benin
  "BO",   // Bolivia
  "BV",   // Bouvet Island
  "IO",   // British Indian Ocean Territory
  "BG",   // Bulgaria
  "BF",   // Burkina Faso
  "CV",   // Cabo Verde
  "KH",   // Cambodia
  "CM",   // Cameroon
  "CF",   // Central African Republic
  "TD",   // Chad
  "CX",   // Christmas Island
  "CC",   // Cocos (Keeling) Islands
  "KM",   // Comoros
  "CG",   // Congo (Republic of, Brazzaville)
  "CK",   // Cook Islands
  "CI",   // Côte d'Ivoire
  "DJ",   // Djibouti
  "GQ",   // Equatorial Guinea
  "ER",   // Eritrea
  "SZ",   // Eswatini
  "ET",   // Ethiopia
  "FK",   // Falkland Islands
  "FO",   // Faroe Islands
  "TF",   // French Southern Territories
  "GA",   // Gabon
  "GI",   // Gibraltar
  "GN",   // Guinea
  "GW",   // Guinea-Bissau
  "HT",   // Haiti
  "HM",   // Heard Island & McDonald Islands
  "ID",   // Indonesia
  "JM",   // Jamaica
  "KE",   // Kenya
  "KI",   // Kiribati
  "KW",   // Kuwait
  "KG",   // Kyrgyzstan
  "LA",   // Lao People's Democratic Republic
  "LS",   // Lesotho
  "LR",   // Liberia
  "MG",   // Madagascar
  "MV",   // Maldives
  "ML",   // Mali
  "MR",   // Mauritania
  "MC",   // Monaco
  "MS",   // Montserrat
  "MZ",   // Mozambique
  "NA",   // Namibia
  "NP",   // Nepal
  "NI",   // Nicaragua
  "NE",   // Niger
  "NG",   // Nigeria
  "NF",   // Norfolk Island
  "PK",   // Pakistan
  "PW",   // Palau
  "PA",   // Panama
  "PG",   // Papua New Guinea
  "PH",   // Philippines
  "PN",   // Pitcairn
  "SH",   // Saint Helena, Ascension & Tristan da Cunha
  "KN",   // Saint Kitts and Nevis
  "ST",   // São Tomé and Príncipe
  "SN",   // Senegal
  "SL",   // Sierra Leone
  "SB",   // Solomon Islands
  "ZA",   // South Africa
  "GS",   // South Georgia & South Sandwich Islands
  "LK",   // Sri Lanka
  "SR",   // Suriname
  "SJ",   // Svalbard and Jan Mayen
  "TJ",   // Tajikistan
  "TZ",   // Tanzania
  "TH",   // Thailand
  "TG",   // Togo
  "TK",   // Tokelau
  "TO",   // Tonga
  "TT",   // Trinidad & Tobago
  "TR",   // Turkey
  "TM",   // Turkmenistan
  "TV",   // Tuvalu
  "UG",   // Uganda
  "UA",   // Ukraine — see header for sub-national territories gap
  "AE",   // United Arab Emirates
  "UM",   // US Minor Outlying Islands
  "VU",   // Vanuatu
  "VN",   // Vietnam
  "VG",   // Virgin Islands (British)
  "EH",   // Western Sahara
  "ZW",   // Zimbabwe
]);

export type PartnerCountryStatus = 'prohibited' | 'unavailable' | 'controlled' | 'supported';

const ISO3_TO_ISO2: Record<string, string> = {
  AFG: 'AF',
  AUS: 'AU',
  BGD: 'BD',
  BTN: 'BT',
  BDI: 'BI',
  CAF: 'CF',
  CHN: 'CN',
  CUB: 'CU',
  DZA: 'DZ',
  ERI: 'ER',
  GNB: 'GW',
  HTI: 'HT',
  IDN: 'ID',
  IRN: 'IR',
  IRQ: 'IQ',
  JPN: 'JP',
  KEN: 'KE',
  LBN: 'LB',
  LBY: 'LY',
  MAR: 'MA',
  MLI: 'ML',
  MMR: 'MM',
  MOZ: 'MZ',
  MYS: 'MY',
  NER: 'NE',
  NPL: 'NP',
  NZL: 'NZ',
  PAK: 'PK',
  PHL: 'PH',
  PRK: 'KP',
  PSE: 'PS',
  QAT: 'QA',
  RUS: 'RU',
  SDN: 'SD',
  SGP: 'SG',
  SOM: 'SO',
  SSD: 'SS',
  SYR: 'SY',
  THA: 'TH',
  TUN: 'TN',
  VEN: 'VE',
  VNM: 'VN',
  YEM: 'YE',
  ZWE: 'ZW',
};

export function normalizeBridgeCountryCode(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  const upper = String(countryCode).trim().toUpperCase();
  if (!upper) return null;
  return ISO3_TO_ISO2[upper] || upper;
}

/** Returns the Bridge tier for a country code. */
export function partnerCountryTier(countryCode: string | null | undefined): PartnerCountryStatus {
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return 'supported';
  if (BRIDGE_PROHIBITED_COUNTRIES.has(upper))   return 'prohibited';
  if (BRIDGE_UNAVAILABLE_COUNTRIES.has(upper))  return 'unavailable';
  if (BRIDGE_CONTROLLED_COUNTRIES.has(upper))   return 'controlled';
  return 'supported';
}

/** True if Bridge customer creation will be hard-blocked server-side
 *  due to sanctions. */
export function isBridgeProhibited(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_PROHIBITED_COUNTRIES.has(upper);
}

/** True if Bridge has marked the country as Unavailable
 *  (commercial/regulatory; hard-blocked server-side). */
export function isBridgeUnavailable(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_UNAVAILABLE_COUNTRIES.has(upper);
}

/** True if Bridge classifies the country as Controlled / High Risk.
 *  Server does NOT hard-block these per round-9 policy; UI may surface
 *  a "limited support" hint. */
export function isBridgeControlled(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_CONTROLLED_COUNTRIES.has(upper);
}

/** Convenience predicate matching the server's `isBridgeBlocked`. */
export function isBridgeBlocked(countryCode: string | null | undefined): boolean {
  return isBridgeProhibited(countryCode) || isBridgeUnavailable(countryCode);
}

export type BridgeVirtualAccountCurrency = 'USD' | 'EUR' | 'GBP';

/**
 * Bridge product availability for the products BorderPay can actually
 * provision today. This is intentionally narrower than Bridge's full rail
 * table: the backend currently supports USD ACH/FedWire plus EUR/GBP
 * SEPA/FPS virtual accounts, not MXN/BRL/COP or SWIFT products yet.
 *
 * Source: Bridge Supported Countries List, captured 2026-06-03.
 * https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list
 */
const BRIDGE_VA_NO_US_RAIL: ReadonlySet<string> = new Set([
  'BD', // Bangladesh
  'BT', // Bhutan
  'DZ', // Algeria
  'BI', // Burundi
  'CN', // China
  'GW', // Guinea-Bissau
  'HT', // Haiti
  'JP', // Japan
  'KE', // Kenya
  'XK', // Kosovo
  'MA', // Morocco
  'MZ', // Mozambique
  'NP', // Nepal
  'NE', // Niger
  'PK', // Pakistan
  'QA', // Qatar
  'TN', // Tunisia
  'ZW', // Zimbabwe
]);

const BRIDGE_VA_NO_SEPA_FPS_RAIL: ReadonlySet<string> = new Set([
  'DZ', // Algeria
  'BI', // Burundi
  'CF', // Central African Republic
  'CN', // China
  'ER', // Eritrea
  'GW', // Guinea-Bissau
  'JP', // Japan
  'ML', // Mali
  'TN', // Tunisia
]);

const BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES: ReadonlySet<string> = new Set([
  'ID', // Indonesia: VA can settle to a user-owned external wallet address.
]);

export function bridgeVirtualAccountCurrenciesForCountry(
  countryCode: string | null | undefined,
): BridgeVirtualAccountCurrency[] {
  if (!countryCode || isBridgeBlocked(countryCode)) return [];
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return [];
  const currencies: BridgeVirtualAccountCurrency[] = [];
  if (!BRIDGE_VA_NO_US_RAIL.has(upper)) currencies.push('USD');
  if (!BRIDGE_VA_NO_SEPA_FPS_RAIL.has(upper)) currencies.push('EUR', 'GBP');
  return currencies;
}

export function isBridgeVirtualAccountCurrencyAvailable(
  countryCode: string | null | undefined,
  currency: string | null | undefined,
): boolean {
  if (!currency) return false;
  return bridgeVirtualAccountCurrenciesForCountry(countryCode).includes(
    currency.toUpperCase() as BridgeVirtualAccountCurrency,
  );
}

export function isBridgeCustodialWalletSupported(countryCode: string | null | undefined): boolean {
  if (!countryCode || isBridgeBlocked(countryCode)) return false;
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && !BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES.has(upper);
}

// ───────────────────────────────────────────────────────────────────────────
// Back-compat shims for code that pre-dates the round-9 policy refresh.
// New callers should use partnerCountryTier / isBridgeBlocked / isBridgeControlled.
// ───────────────────────────────────────────────────────────────────────────

export interface PartnerCountryEntry {
  code:    string;
  name:    string;
  status:  'coming-soon' | 'partner-only' | 'sanctioned' | 'unavailable';
  reason?: string;
}

/** Pre-round-9 shape; kept so old country-picker code keeps compiling.
 *  The single DRC entry is preserved as the only "coming-soon" entry. */
export const COMING_SOON_COUNTRIES: readonly PartnerCountryEntry[] = [
  {
    code:   'CD',
    name:   'Democratic Republic of the Congo',
    status: 'coming-soon',
    reason: 'BorderPay does not yet support DRC residents. We are bringing local rails online for this corridor.',
  },
];

/** Sanctioned-jurisdiction entries (the 17 non-DRC Prohibited countries).
 *  Renders separately from "coming-soon" in the UI so we never imply
 *  Iran / North Korea / Russia are "coming online soon". */
export const SANCTIONED_COUNTRY_ENTRIES: readonly PartnerCountryEntry[] = [
  { code: 'AF', name: 'Afghanistan',                  status: 'sanctioned' },
  { code: 'BY', name: 'Belarus',                      status: 'sanctioned' },
  { code: 'CU', name: 'Cuba',                         status: 'sanctioned' },
  { code: 'PS', name: 'Palestinian Territories',      status: 'sanctioned', reason: 'Includes Gaza Strip and West Bank.' },
  { code: 'IR', name: 'Iran',                         status: 'sanctioned' },
  { code: 'IQ', name: 'Iraq',                         status: 'sanctioned' },
  { code: 'LB', name: 'Lebanon',                      status: 'sanctioned' },
  { code: 'LY', name: 'Libya',                        status: 'sanctioned' },
  { code: 'MM', name: 'Myanmar (Burma)',              status: 'sanctioned' },
  { code: 'KP', name: 'North Korea (DPRK)',           status: 'sanctioned' },
  { code: 'RU', name: 'Russia',                       status: 'sanctioned' },
  { code: 'SO', name: 'Somalia',                      status: 'sanctioned' },
  { code: 'SS', name: 'South Sudan',                  status: 'sanctioned' },
  { code: 'SD', name: 'Sudan',                        status: 'sanctioned' },
  { code: 'SY', name: 'Syria',                        status: 'sanctioned' },
  { code: 'VE', name: 'Venezuela',                    status: 'sanctioned' },
  { code: 'YE', name: 'Yemen',                        status: 'sanctioned' },
];

/** Commercial-unavailability entries (the 5 BRIDGE_UNAVAILABLE_COUNTRIES).
 *  Not sanctions — Bridge has stated services are unavailable for these
 *  jurisdictions for commercial/regulatory reasons. Distinct UI copy
 *  from sanctioned + from coming-soon. */
export const UNAVAILABLE_COUNTRY_ENTRIES: readonly PartnerCountryEntry[] = [
  { code: 'DZ', name: 'Algeria',  status: 'unavailable' },
  { code: 'BI', name: 'Burundi',  status: 'unavailable' },
  { code: 'CN', name: 'China',    status: 'unavailable' },
  { code: 'JP', name: 'Japan',    status: 'unavailable' },
  { code: 'TN', name: 'Tunisia',  status: 'unavailable' },
];

/** Back-compat: combined Prohibited list (DRC + sanctioned), preserved
 *  for any consumer that wants a single-section render. New consumers
 *  should prefer the per-tier lists above. */
export const PROHIBITED_COUNTRY_ENTRIES: readonly PartnerCountryEntry[] = [
  ...COMING_SOON_COUNTRIES,
  ...SANCTIONED_COUNTRY_ENTRIES,
];

/** True ONLY for countries in COMING_SOON_COUNTRIES (currently just DRC).
 *  Round-10 fix: previously aliased to isBridgeProhibited, which made
 *  every sanctioned country (Iran, North Korea, Russia, …) flow through
 *  the "coming soon" semantic and risked UI copy reintroducing
 *  "sanctions countries coming online soon" claims. Sanctions countries
 *  must be checked with isBridgeProhibited, NOT this helper.
 *
 *  For "any country the Bridge server would hard-block", use
 *  isBridgeBlocked (covers Prohibited + Unavailable). */
export function isComingSoon(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return false;
  return COMING_SOON_COUNTRIES.some(c => c.code === upper);
}

export function partnerCountryEntry(countryCode: string | null | undefined): PartnerCountryEntry | null {
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return null;
  return COMING_SOON_COUNTRIES.find(c => c.code === upper) ?? null;
}
