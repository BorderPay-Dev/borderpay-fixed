/**
 * Frontend mirror of the Bridge country eligibility policy.
 *
 * The server-side authority lives in
 * `supabase/functions/_shared/providers/bridge-country-policy.ts`.
 * The frontend cannot import server modules directly, so this file
 * restates the same two sets for UI rendering (signup country picker,
 * Geographic restrictions screen, KYC pre-checks).
 *
 * STRICT MIRROR: the BRIDGE_PROHIBITED_COUNTRIES and
 * BRIDGE_CONTROLLED_COUNTRIES sets MUST stay byte-identical to the
 * server file. Enforced by `tests/audit/bridge_country_policy_audit.py`.
 * Edit both files in lockstep; the audit script will fail CI if they
 * drift.
 *
 * Tier semantics (matches server):
 *   • Prohibited  → server hard-blocks any Bridge call.
 *                   UI: surface as "coming soon via local-rails partner".
 *   • Controlled  → server does NOT block; emits an observability log.
 *                   UI: signup IS allowed, but partner-backed financial
 *                   products carry a "limited support" hint per round-9
 *                   policy (BorderPay does not yet have Bridge approval
 *                   letters for these jurisdictions).
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

/** Returns the Bridge tier for a country code. */
export function partnerCountryTier(countryCode: string | null | undefined): PartnerCountryStatus {
  if (!countryCode) return 'supported';
  const upper = countryCode.toUpperCase();
  if (BRIDGE_PROHIBITED_COUNTRIES.has(upper))   return 'prohibited';
  if (BRIDGE_UNAVAILABLE_COUNTRIES.has(upper))  return 'unavailable';
  if (BRIDGE_CONTROLLED_COUNTRIES.has(upper))   return 'controlled';
  return 'supported';
}

/** True if Bridge customer creation will be hard-blocked server-side
 *  due to sanctions. */
export function isBridgeProhibited(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return BRIDGE_PROHIBITED_COUNTRIES.has(countryCode.toUpperCase());
}

/** True if Bridge has marked the country as Unavailable
 *  (commercial/regulatory; hard-blocked server-side). */
export function isBridgeUnavailable(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return BRIDGE_UNAVAILABLE_COUNTRIES.has(countryCode.toUpperCase());
}

/** True if Bridge classifies the country as Controlled / High Risk.
 *  Server does NOT hard-block these per round-9 policy; UI may surface
 *  a "limited support" hint. */
export function isBridgeControlled(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return BRIDGE_CONTROLLED_COUNTRIES.has(countryCode.toUpperCase());
}

/** Convenience predicate matching the server's `isBridgeBlocked`. */
export function isBridgeBlocked(countryCode: string | null | undefined): boolean {
  return isBridgeProhibited(countryCode) || isBridgeUnavailable(countryCode);
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
    reason: 'Our verification partner does not yet support DRC residents. We are bringing it online via our African local-rails partner.',
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

export function isComingSoon(countryCode: string | null | undefined): boolean {
  // Back-compat alias for isBridgeProhibited. Prior code used this to mean
  // "Bridge does not support this country yet"; that semantic is now
  // covered by the broader Prohibited set.
  return isBridgeProhibited(countryCode);
}

export function partnerCountryEntry(countryCode: string | null | undefined): PartnerCountryEntry | null {
  if (!countryCode) return null;
  const upper = countryCode.toUpperCase();
  return COMING_SOON_COUNTRIES.find(c => c.code === upper) ?? null;
}
