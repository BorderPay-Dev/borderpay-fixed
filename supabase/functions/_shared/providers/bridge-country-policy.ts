/**
 * Bridge country eligibility policy — AUTHORITATIVE.
 *
 * Source of truth for every server-side gate that touches a Bridge call
 * path (bridge-customer, bridge-kyc-link, bridge-kyb-link, bridge-wallet,
 * bridge-virtual-account, bridge-transfer). The frontend mirror lives at
 * `utils/compliance/partnerCountryPolicy.ts` and MUST stay byte-identical
 * to this file's two sets — enforced by `tests/audit/bridge_country_policy_audit.py`.
 *
 * Bridge classifies jurisdictions into three tiers:
 *
 *   1. PROHIBITED — Bridge will not facilitate any service for residents
 *      of these jurisdictions, on any payment rail. We HARD-BLOCK before
 *      any Bridge API call. Returns HTTP 403 + `country_not_supported`.
 *
 *   2. HIGH RISK / CONTROLLED — Bridge facilitates services with
 *      additional due-diligence requirements and per-rail controls.
 *      Per round-9 CTO decision: BorderPay does NOT (yet) hard-block
 *      these. Instead, every Bridge edge function logs a structured
 *      warning when a Controlled-country user transacts, so the
 *      compliance owner has observability while gathering Bridge
 *      approval letters. This is the "conservative legal floor"
 *      stance: we enforce the sanctions-relevant Prohibited tier and
 *      treat Controlled as an audit/observability concern.
 *
 *   3. SUPPORTED — anything not in the above two sets. No log, no block.
 *      Note: this is a default-allow tier. Adding a new country to the
 *      Prohibited or Controlled set is opt-in here; unknown country
 *      codes default through as Supported. This is intentional given
 *      Bridge's published list is positive (it enumerates the two
 *      restricted tiers, not the supported tier).
 *
 * Source: https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list
 * Captured: 2026-05-21.
 *
 * Round-9 P1 hardening:
 *   - Previously only `CD` was in the Prohibited set. Expanded to the
 *     full 18 sanctions-relevant codes from Bridge's published list.
 *     Live impact check on 2026-05-21: zero users currently reside in
 *     any newly-prohibited country (verified against user_profiles), so
 *     this tightening is a no-op for current customers.
 *   - Added the full 102-code Controlled set with the observability
 *     logger.
 *   - Removed inline `new Set(["CD"])` from bridge-kyc-link and
 *     bridge-kyb-link — they now consult `isBridgeBlocked` like every
 *     other Bridge edge function.
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

/** ISO-3166 alpha-2 codes Bridge classifies as HIGH RISK / CONTROLLED.
 *  Not blocked — logged via logControlledBridgeTraffic so compliance has
 *  visibility while collecting approval letters. */
export const BRIDGE_CONTROLLED_COUNTRIES: ReadonlySet<string> = new Set([
  "AX",   // Åland Islands
  "DZ",   // Algeria (all rails blocked at Bridge)
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
  "BI",   // Burundi (all rails blocked at Bridge)
  "CV",   // Cabo Verde
  "KH",   // Cambodia
  "CM",   // Cameroon
  "CF",   // Central African Republic (no SEPA/FPS)
  "TD",   // Chad
  "CN",   // China (all rails blocked at Bridge)
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

/** Returns true if Bridge classifies the country as Prohibited.
 *  Internal helper — most callers want isBridgeBlocked. */
export function isBridgeProhibited(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return BRIDGE_PROHIBITED_COUNTRIES.has(countryCode.toUpperCase());
}

/** Returns true if Bridge classifies the country as Controlled / High Risk.
 *  Used by the observability logger; NOT a blocker per round-9 policy. */
export function isBridgeControlled(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return BRIDGE_CONTROLLED_COUNTRIES.has(countryCode.toUpperCase());
}

/** AUTHORITATIVE gate. Returns true only for Prohibited.
 *  Every Bridge edge function should consult this BEFORE any Bridge API
 *  call. Controlled countries pass this gate; call
 *  logControlledBridgeTraffic alongside for observability. */
export function isBridgeBlocked(countryCode: string | null | undefined): boolean {
  return isBridgeProhibited(countryCode);
}

/** Structured 403 response for a blocked (Prohibited) country.
 *  The frontend renders the message as a future-state notice without
 *  naming the eventual local-rails partner as live. */
export function bridgeCountryBlockResponse(countryCode: string) {
  return {
    success: false as const,
    code:    "country_not_supported",
    error:   `${humanCountry(countryCode)} support is coming through our African local rails partner.`,
    country: countryCode.toUpperCase(),
    reason:  "prohibited" as const,
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
