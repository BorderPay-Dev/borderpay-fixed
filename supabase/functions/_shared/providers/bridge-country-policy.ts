/**
 * Bridge country eligibility policy — AUTHORITATIVE.
 *
 * Source of truth for every server-side gate that touches a Bridge call
 * path (bridge-customer, bridge-kyc-link, bridge-kyb-link, bridge-wallet,
 * bridge-virtual-account, bridge-transfer). The frontend mirror lives at
 * `utils/compliance/partnerCountryPolicy.ts` and MUST stay byte-identical
 * to this file's THREE country sets (Prohibited, Unavailable, Controlled)
 * — enforced by `tests/audit/bridge_country_policy_audit.py`.
 *
 * Bridge classifies jurisdictions into FOUR tiers (round-10 update):
 *
 *   1. PROHIBITED — sanctions-relevant; Bridge will not facilitate any
 *      service. We HARD-BLOCK before any Bridge API call. Returns 403
 *      + `country_not_supported` + reason=`prohibited`.
 *
 *   2. UNAVAILABLE — commercial / regulatory unavailability. Bridge's
 *      docs explicitly state "Bridge services are unavailable for
 *      individuals and businesses located in Algeria, Burundi, China,
 *      Japan, and Tunisia." Not sanctions, but Bridge still will not
 *      facilitate any rail. We HARD-BLOCK with reason=`unavailable`.
 *      Round-10 P1 fix: added after the CTO flagged that the previous
 *      version only warned for DZ/BI/CN and treated JP/TN as Supported.
 *
 *   3. HIGH RISK / CONTROLLED — Bridge facilitates services with
 *      additional due-diligence requirements and per-rail controls.
 *      Per round-9 CTO decision: BorderPay does NOT (yet) hard-block
 *      these. Instead, every Bridge edge function logs a structured
 *      warning when a Controlled-country user transacts, so the
 *      compliance owner has observability while gathering Bridge
 *      approval letters. This is the "conservative legal floor"
 *      stance: we enforce the sanctions+commercial-unavailable tiers
 *      and treat Controlled as an audit/observability concern.
 *
 *   4. SUPPORTED — anything not in the above three sets. No log, no block.
 *      Note: this is a default-allow tier. Adding a new country to one
 *      of the restricted tiers is opt-in here; unknown country codes
 *      default through as Supported. This is intentional given
 *      Bridge's published list is positive (it enumerates the
 *      restricted tiers, not the supported tier).
 *
 * Source: https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list
 * Captured: 2026-05-21.
 *
 * Round-9 → round-10 P1 hardening:
 *   - Round-9 expanded Prohibited from {CD} to 18 sanctions-relevant codes
 *     and added a 97-code Controlled set with observability logging.
 *   - Round-10 (this revision) added the UNAVAILABLE tier with 5 codes
 *     (DZ, BI, CN, JP, TN — "Bridge services are unavailable"). DZ/BI/CN
 *     were previously in Controlled (warned but not blocked); JP/TN were
 *     defaulting through as Supported. All five are now hard-blocked.
 *   - Round-10 also fixed an ordering bug in bridge-customer where the
 *     country gate ran AFTER the idempotent existing-customer return,
 *     letting a prohibited-country user with a stale bridge_customer_id
 *     bypass the block.
 *   - Live impact check on 2026-05-21: zero users currently reside in
 *     any newly-prohibited country (verified against user_profiles); one
 *     Algerian user with no Bridge customer ID was in the prior dataset
 *     — they now hit the hard block instead of a warn log.
 *
 * Gaps explicitly NOT handled here (documented for the next compliance
 * pass; raise a P1 to revisit):
 *   - Ukrainian Territories (Crimea, Sevastopol, Donetsk, Kherson,
 *     Luhansk, Zaporizhzhia) are Prohibited per Bridge, but our system
 *     only carries ISO-3166 alpha-2 at country granularity. UA-the-
 *     country is Controlled. We classify UA as Controlled and document
 *     the sub-national gap here. A future tightening can either add a
 *     signup attestation, or hard-block UA outright.
 */

/** ISO-3166 alpha-2 codes Bridge classifies as PROHIBITED.
 *  Hard-blocked before any Bridge API call. */
export const BRIDGE_PROHIBITED_COUNTRIES: ReadonlySet<string> = new Set([
  "AF",   // Afghanistan
  "BY",   // Belarus
  "CD",   // Congo, Democratic Republic (DRC)
  "CU",   // Cuba
  "PS",   // Palestine — covers both Gaza Strip and West Bank (Bridge lists ISO PSE for both)
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
  // Sevastopol, Donetsk, Kherson, Luhansk, Zaporizhzhia). Our system
  // only has ISO-2 country granularity, so we cannot enforce sub-
  // nationally. UA-the-country is classified Controlled below; see the
  // file header for the documented gap.
]);

/** ISO-3166 alpha-2 codes Bridge has marked as UNAVAILABLE.
 *  Bridge docs: "Bridge services are unavailable for individuals and
 *  businesses located in Algeria, Burundi, China, Japan, and Tunisia."
 *  Not sanctions, but Bridge still will not facilitate any rail. We
 *  HARD-BLOCK these alongside Prohibited. */
export const BRIDGE_UNAVAILABLE_COUNTRIES: ReadonlySet<string> = new Set([
  "DZ",   // Algeria
  "BI",   // Burundi
  "CN",   // China
  "JP",   // Japan
  "TN",   // Tunisia
]);

/** ISO-3166 alpha-2 codes Bridge classifies as HIGH RISK / CONTROLLED.
 *  Not blocked — logged via logControlledBridgeTraffic so compliance has
 *  visibility while collecting approval letters.
 *  Round-10: DZ, BI, CN moved out of this set into UNAVAILABLE. */
export const BRIDGE_CONTROLLED_COUNTRIES: ReadonlySet<string> = new Set([
  "AX",   // Åland Islands
  "AO",   // Angola
  "AQ",   // Antarctica
  "BD",   // Bangladesh (no ACH)
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
  "CF",   // Central African Republic (no SEPA/FPS)
  "TD",   // Chad
  "CX",   // Christmas Island
  "CC",   // Cocos (Keeling) Islands
  "KM",   // Comoros
  "CG",   // Congo (Republic of, Brazzaville — distinct from DRC which is Prohibited)
  "CK",   // Cook Islands
  "CI",   // Côte d'Ivoire
  "DJ",   // Djibouti
  "GQ",   // Equatorial Guinea
  "ER",   // Eritrea (no SEPA/FPS)
  "SZ",   // Eswatini (Swaziland)
  "ET",   // Ethiopia
  "FK",   // Falkland Islands
  "FO",   // Faroe Islands
  "TF",   // French Southern Territories
  "GA",   // Gabon
  "GI",   // Gibraltar
  "GN",   // Guinea
  "GW",   // Guinea-Bissau (all rails blocked at Bridge)
  "HT",   // Haiti (no ACH)
  "HM",   // Heard Island & McDonald Islands
  "ID",   // Indonesia (no custodial wallets)
  "JM",   // Jamaica
  "KE",   // Kenya (no ACH) — BorderPay current largest market
  "KI",   // Kiribati
  "KW",   // Kuwait
  "KG",   // Kyrgyzstan
  "LA",   // Lao People's Democratic Republic
  "LS",   // Lesotho
  "LR",   // Liberia
  "MG",   // Madagascar
  "MV",   // Maldives
  "ML",   // Mali (no SEPA/FPS)
  "MR",   // Mauritania
  "MC",   // Monaco
  "MS",   // Montserrat
  "MZ",   // Mozambique (no ACH)
  "NA",   // Namibia
  "NP",   // Nepal (no ACH)
  "NI",   // Nicaragua
  "NE",   // Niger (no ACH)
  "NG",   // Nigeria — BorderPay second-largest market
  "NF",   // Norfolk Island
  "PK",   // Pakistan (no ACH)
  "PW",   // Palau
  "PA",   // Panama
  "PG",   // Papua New Guinea
  "PH",   // Philippines (no custodial wallets)
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
  "TH",   // Thailand (no custodial wallets)
  "TG",   // Togo
  "TK",   // Tokelau
  "TO",   // Tonga
  "TT",   // Trinidad & Tobago
  "TR",   // Turkey
  "TM",   // Turkmenistan
  "TV",   // Tuvalu
  "UG",   // Uganda
  "UA",   // Ukraine — see file header for the sub-national territories gap
  "AE",   // United Arab Emirates
  "UM",   // US Minor Outlying Islands
  "VU",   // Vanuatu
  "VN",   // Vietnam (no custodial wallets)
  "VG",   // Virgin Islands (British)
  "EH",   // Western Sahara
  "ZW",   // Zimbabwe (no ACH)
]);

/** Returns true if Bridge classifies the country as Prohibited (sanctions). */
export function isBridgeProhibited(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return upper ? BRIDGE_PROHIBITED_COUNTRIES.has(upper) : false;
}

/** Returns true if Bridge has marked the country as Unavailable
 *  (commercial/regulatory, not sanctions). */
export function isBridgeUnavailable(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return upper ? BRIDGE_UNAVAILABLE_COUNTRIES.has(upper) : false;
}

/** Returns true if Bridge classifies the country as Controlled / High Risk.
 *  Used by the observability logger; NOT a blocker per round-9 policy. */
export function isBridgeControlled(countryCode: string | null | undefined): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return upper ? BRIDGE_CONTROLLED_COUNTRIES.has(upper) : false;
}

/** AUTHORITATIVE gate. Returns true for Prohibited OR Unavailable.
 *  Every Bridge edge function should consult this BEFORE any Bridge API
 *  call AND before any idempotent early-return. Controlled countries
 *  pass this gate; call logControlledBridgeTraffic alongside for
 *  observability. */
export function isBridgeBlocked(countryCode: string | null | undefined): boolean {
  return isBridgeProhibited(countryCode) || isBridgeUnavailable(countryCode);
}

export type BridgeVirtualAccountCurrency = "USD" | "EUR" | "GBP";

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
  "BD", // Bangladesh
  "BT", // Bhutan
  "DZ", // Algeria
  "BI", // Burundi
  "CN", // China
  "GW", // Guinea-Bissau
  "HT", // Haiti
  "JP", // Japan
  "KE", // Kenya
  "XK", // Kosovo
  "MA", // Morocco
  "MZ", // Mozambique
  "NP", // Nepal
  "NE", // Niger
  "PK", // Pakistan
  "QA", // Qatar
  "TN", // Tunisia
  "ZW", // Zimbabwe
]);

const BRIDGE_VA_NO_SEPA_FPS_RAIL: ReadonlySet<string> = new Set([
  "DZ", // Algeria
  "BI", // Burundi
  "CF", // Central African Republic
  "CN", // China
  "ER", // Eritrea
  "GW", // Guinea-Bissau
  "JP", // Japan
  "ML", // Mali
  "TN", // Tunisia
]);

const BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES: ReadonlySet<string> = new Set([
  "AU", // Australia
  "GW", // Guinea-Bissau
  "HK", // Hong Kong
  "ID", // Indonesia
  "JP", // Japan
  "MY", // Malaysia
  "NZ", // New Zealand
  "PH", // Philippines
  "SG", // Singapore
  "TH", // Thailand
  "VN", // Vietnam
]);

const ISO3_TO_ISO2: Record<string, string> = {
  AGO: "AO", ARE: "AE", AUS: "AU", BGD: "BD", BEN: "BJ", BFA: "BF", BDI: "BI",
  BGR: "BG", BHR: "BH", BLR: "BY", BOL: "BO", BRA: "BR", BTN: "BT", CAF: "CF",
  CAN: "CA", CHE: "CH", CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COG: "CG",
  COL: "CO", CPV: "CV", CUB: "CU", DEU: "DE", DJI: "DJ", DZA: "DZ", EGY: "EG",
  ERI: "ER", ETH: "ET", FRA: "FR", GAB: "GA", GBR: "GB", GHA: "GH", GIN: "GN",
  GMB: "GM", GNB: "GW", GNQ: "GQ", HTI: "HT", IDN: "ID", IND: "IN", IRN: "IR",
  IRQ: "IQ", JPN: "JP", KEN: "KE", KHM: "KH", KWT: "KW", LBN: "LB", LBR: "LR",
  LBY: "LY", LKA: "LK", LSO: "LS", MAR: "MA", MDG: "MG", MLI: "ML", MMR: "MM",
  MOZ: "MZ", MRT: "MR", MWI: "MW", MYS: "MY", NAM: "NA", NER: "NE", NGA: "NG",
  NPL: "NP", PAK: "PK", PHL: "PH", PSE: "PS", QAT: "QA", RUS: "RU", RWA: "RW",
  SDN: "SD", SEN: "SN", SLE: "SL", SOM: "SO", SSD: "SS", STP: "ST", SWZ: "SZ",
  SYR: "SY", TCD: "TD", TGO: "TG", THA: "TH", TUN: "TN", TUR: "TR", TZA: "TZ",
  UGA: "UG", UKR: "UA", USA: "US", VEN: "VE", VNM: "VN", YEM: "YE", ZAF: "ZA",
  ZMB: "ZM", ZWE: "ZW",
};

function normalizeBridgeCountryCode(countryCode: string | null | undefined): string | null {
  const upper = String(countryCode || "").trim().toUpperCase();
  if (!upper) return null;
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (/^[A-Z]{3}$/.test(upper)) return ISO3_TO_ISO2[upper] ?? upper;
  return upper;
}

export function bridgeVirtualAccountCurrenciesForCountry(
  countryCode: string | null | undefined,
): BridgeVirtualAccountCurrency[] {
  if (!countryCode || isBridgeBlocked(countryCode)) return [];
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return [];
  const currencies: BridgeVirtualAccountCurrency[] = [];
  if (!BRIDGE_VA_NO_US_RAIL.has(upper)) currencies.push("USD");
  if (!BRIDGE_VA_NO_SEPA_FPS_RAIL.has(upper)) currencies.push("EUR", "GBP");
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
  return upper ? !BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES.has(upper) : false;
}

/** Tier classification for a country code (mirrors frontend
 *  partnerCountryTier). */
export type BridgeCountryTier = "prohibited" | "unavailable" | "controlled" | "supported";

export function bridgeCountryTier(countryCode: string | null | undefined): BridgeCountryTier {
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return "supported";
  if (BRIDGE_PROHIBITED_COUNTRIES.has(upper))   return "prohibited";
  if (BRIDGE_UNAVAILABLE_COUNTRIES.has(upper))  return "unavailable";
  if (BRIDGE_CONTROLLED_COUNTRIES.has(upper))   return "controlled";
  return "supported";
}

/** Structured 403 response for a blocked country. The `reason` field
 *  carries the tier so callers / frontends can render a tier-specific
 *  message. The default `error` string is generic on purpose — UIs
 *  should consult `reason` and render their own copy. The four-tier
 *  copy split is:
 *    • Prohibited (sanctions, the 17 non-DRC entries)  → "support is
 *      not available through BorderPay"
 *      (sanctions-language section in the UI).
 *    • Prohibited + display-override (DRC only)        → "coming soon
 *      via local rails" (display-level override applied at
 *      the UI layer in `COMING_SOON_COUNTRIES`; the server still
 *      returns reason=`prohibited`).
 *    • Unavailable (DZ / BI / CN / JP / TN)            → "not
 *      currently serviceable by BorderPay"
 *      (commercial / regulatory, not sanctions).
 *  Controlled and Supported never reach this function (gate doesn't
 *  fire for them). */
export function bridgeCountryBlockResponse(countryCode: string) {
  const upper = countryCode.toUpperCase();
  const tier  = bridgeCountryTier(upper);
  // Tier is narrowed to the blocked tiers because callers should only
  // invoke this after isBridgeBlocked returned true; the fallback
  // 'prohibited' default is just for type safety.
  const reason: "prohibited" | "unavailable" =
    tier === "unavailable" ? "unavailable" : "prohibited";
  return {
    success: false as const,
    code:    "country_not_supported",
    error:   reason === "unavailable"
      ? `${humanCountry(upper)} is not currently serviceable by BorderPay.`
      : `${humanCountry(upper)} support is not available through BorderPay.`,
    country: upper,
    reason,
  };
}

/** Side-effectful structured log for observability. Call this alongside
 *  isBridgeBlocked in every Bridge edge function so the compliance owner
 *  can spot Controlled-country traffic in Supabase Edge logs.
 *
 *  Emits no output for Prohibited (already blocked + logged elsewhere)
 *  or Supported. Only fires for Controlled / High Risk countries.
 *
 *  Format is grep-friendly: `bridge_controlled_country fn=<…> country=<…> user_id=<…>`. */
export function logControlledBridgeTraffic(
  fn:          string,
  countryCode: string | null | undefined,
  userId:      string | null | undefined,
): void {
  if (!countryCode) return;
  const upper = countryCode.toUpperCase();
  if (!BRIDGE_CONTROLLED_COUNTRIES.has(upper)) return;
  console.warn(
    `bridge_controlled_country fn=${fn} country=${upper} user_id=${userId ?? "anon"} ` +
    `policy=high_risk_no_block awaiting_approval_letter=true`,
  );
}

function humanCountry(code: string): string {
  const u = code.toUpperCase();
  if (u === "CD") return "DRC";
  if (u === "KP") return "DPRK";
  if (u === "PS") return "Palestinian Territories";
  return u;
}

// ─────────────────────────────────────────────────────────────────────────────
// African payout-corridor classification (#B1). Distinct from the Bridge
// eligibility tiers above: this set decides which destinations route through the
// localized African aggregator vs the international payout API. Centralized here
// so country sets stay in one canonical module (per the parity audit).
// ─────────────────────────────────────────────────────────────────────────────
export const AFRICAN_PAYOUT_COUNTRIES: ReadonlySet<string> = new Set([
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG", "CD",
  "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE",
  "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG",
  "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG",
  "ZM", "ZW",
]);

export function isAfricanPayoutCountry(countryCode: string | null | undefined): boolean {
  return AFRICAN_PAYOUT_COUNTRIES.has(String(countryCode ?? "").trim().toUpperCase());
}
