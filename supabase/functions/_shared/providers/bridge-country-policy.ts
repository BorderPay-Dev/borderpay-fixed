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
 */ /** ISO-3166 alpha-2 codes Bridge classifies as PROHIBITED.
 *  Hard-blocked before any Bridge API call. */ export const BRIDGE_PROHIBITED_COUNTRIES = new Set([
  "AF",
  "BY",
  "CD",
  "CU",
  "PS",
  "IR",
  "IQ",
  "LB",
  "LY",
  "MM",
  "KP",
  "RU",
  "SO",
  "SS",
  "SD",
  "SY",
  "VE",
  "YE"
]);
/** ISO-3166 alpha-2 codes Bridge has marked as UNAVAILABLE.
 *  Bridge docs: "Bridge services are unavailable for individuals and
 *  businesses located in Algeria, Burundi, China, Japan, and Tunisia."
 *  Not sanctions, but Bridge still will not facilitate any rail. We
 *  HARD-BLOCK these alongside Prohibited. */ export const BRIDGE_UNAVAILABLE_COUNTRIES = new Set([
  "DZ",
  "BI",
  "CN",
  "JP",
  "TN"
]);
/** ISO-3166 alpha-2 codes Bridge classifies as HIGH RISK / CONTROLLED.
 *  Not blocked — logged via logControlledBridgeTraffic so compliance has
 *  visibility while collecting approval letters.
 *  Round-10: DZ, BI, CN moved out of this set into UNAVAILABLE. */ export const BRIDGE_CONTROLLED_COUNTRIES = new Set([
  "AX",
  "AO",
  "AQ",
  "BD",
  "BB",
  "BJ",
  "BO",
  "BV",
  "IO",
  "BG",
  "BF",
  "CV",
  "KH",
  "CM",
  "CF",
  "TD",
  "CX",
  "CC",
  "KM",
  "CG",
  "CK",
  "CI",
  "DJ",
  "GQ",
  "ER",
  "SZ",
  "ET",
  "FK",
  "FO",
  "TF",
  "GA",
  "GI",
  "GN",
  "GW",
  "HT",
  "HM",
  "ID",
  "JM",
  "KE",
  "KI",
  "KW",
  "KG",
  "LA",
  "LS",
  "LR",
  "MG",
  "MV",
  "ML",
  "MR",
  "MC",
  "MS",
  "MZ",
  "NA",
  "NP",
  "NI",
  "NE",
  "NG",
  "NF",
  "PK",
  "PW",
  "PA",
  "PG",
  "PH",
  "PN",
  "SH",
  "KN",
  "ST",
  "SN",
  "SL",
  "SB",
  "ZA",
  "GS",
  "LK",
  "SR",
  "SJ",
  "TJ",
  "TZ",
  "TH",
  "TG",
  "TK",
  "TO",
  "TT",
  "TR",
  "TM",
  "TV",
  "UG",
  "UA",
  "AE",
  "UM",
  "VU",
  "VN",
  "VG",
  "EH",
  "ZW"
]);
const ISO3_TO_ISO2: Readonly<Record<string, string>> = {
  AFG: "AF",
  AUS: "AU",
  AUT: "AT",
  BEL: "BE",
  BGR: "BG",
  BGD: "BD",
  BTN: "BT",
  BDI: "BI",
  CAF: "CF",
  CYP: "CY",
  CZE: "CZ",
  CHN: "CN",
  CUB: "CU",
  DZA: "DZ",
  DEU: "DE",
  DNK: "DK",
  ESP: "ES",
  EST: "EE",
  ERI: "ER",
  FIN: "FI",
  FRA: "FR",
  GNB: "GW",
  GRC: "GR",
  HRV: "HR",
  HUN: "HU",
  HTI: "HT",
  IDN: "ID",
  IRN: "IR",
  IRQ: "IQ",
  IRL: "IE",
  ITA: "IT",
  JPN: "JP",
  KEN: "KE",
  LBN: "LB",
  LTU: "LT",
  LUX: "LU",
  LVA: "LV",
  LBY: "LY",
  MAR: "MA",
  MLI: "ML",
  MMR: "MM",
  MLT: "MT",
  MOZ: "MZ",
  MYS: "MY",
  NER: "NE",
  NPL: "NP",
  NLD: "NL",
  NZL: "NZ",
  PAK: "PK",
  PHL: "PH",
  POL: "PL",
  PRT: "PT",
  PRK: "KP",
  PSE: "PS",
  QAT: "QA",
  RUS: "RU",
  ROU: "RO",
  SDN: "SD",
  SGP: "SG",
  SOM: "SO",
  SSD: "SS",
  SVK: "SK",
  SVN: "SI",
  SWE: "SE",
  SYR: "SY",
  THA: "TH",
  TUN: "TN",
  VEN: "VE",
  VNM: "VN",
  YEM: "YE",
  ZWE: "ZW"
};
/** European Union member states (EU-27), not geographic Europe or the EEA.
 *  GB, NO, IS, LI and CH are deliberately excluded. */ export const BRIDGE_EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE"
]);
export function normalizeBridgeCountryCode(countryCode: unknown): string | null {
  if (!countryCode) return null;
  const upper = String(countryCode).trim().toUpperCase();
  if (!upper) return null;
  return ISO3_TO_ISO2[upper] || upper;
}
export function isBridgeEuropeanUnionCountry(countryCode: unknown): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_EU_COUNTRIES.has(upper);
}
const EU_AUTOMATIC_WALLETS = [
  {
    symbol: "EURC",
    chain: "BASE"
  }
];
const NON_EU_AUTOMATIC_WALLETS = [
  {
    symbol: "USDC",
    chain: "BASE"
  },
  {
    symbol: "USDT",
    chain: "TRON"
  }
];
/** Wallet policy for newly verified customers. EU-27 customers receive only
 * EURC/Base. Existing wallets are never deleted or converted here. */ export function bridgeAutomaticWalletsForCountry(countryCode: unknown): ReadonlyArray<{ symbol: string; chain: string }> {
  return isBridgeEuropeanUnionCountry(countryCode) ? EU_AUTOMATIC_WALLETS : NON_EU_AUTOMATIC_WALLETS;
}
/** Returns true if Bridge classifies the country as Prohibited (sanctions). */ export function isBridgeProhibited(countryCode: unknown): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_PROHIBITED_COUNTRIES.has(upper);
}
/** Returns true if Bridge has marked the country as Unavailable
 *  (commercial/regulatory, not sanctions). */ export function isBridgeUnavailable(countryCode: unknown): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_UNAVAILABLE_COUNTRIES.has(upper);
}
/** Returns true if Bridge classifies the country as Controlled / High Risk.
 *  Used by the observability logger; NOT a blocker per round-9 policy. */ export function isBridgeControlled(countryCode: unknown): boolean {
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && BRIDGE_CONTROLLED_COUNTRIES.has(upper);
}
/** AUTHORITATIVE gate. Returns true for Prohibited OR Unavailable.
 *  Every Bridge edge function should consult this BEFORE any Bridge API
 *  call AND before any idempotent early-return. Controlled countries
 *  pass this gate; call logControlledBridgeTraffic alongside for
 *  observability. */ export function isBridgeBlocked(countryCode: unknown): boolean {
  return isBridgeProhibited(countryCode) || isBridgeUnavailable(countryCode);
}
/**
 * Bridge product availability for the products BorderPay can actually
 * provision today. This is intentionally narrower than Bridge's full rail
 * table: the backend currently supports USD ACH/FedWire plus EUR/GBP
 * SEPA/FPS virtual accounts, not MXN/BRL/COP or SWIFT products yet.
 *
 * Source: Bridge Supported Countries List, captured 2026-06-03.
 * https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list
 */ const BRIDGE_VA_NO_US_RAIL = new Set([
  "BD",
  "BT",
  "DZ",
  "BI",
  "CN",
  "GW",
  "HT",
  "JP",
  "KE",
  "XK",
  "MA",
  "MZ",
  "NP",
  "NE",
  "PK",
  "QA",
  "TN",
  "ZW"
]);
const BRIDGE_VA_NO_SEPA_FPS_RAIL = new Set([
  "DZ",
  "BI",
  "CF",
  "CN",
  "ER",
  "GW",
  "JP",
  "ML",
  "TN"
]);
const BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES = new Set([
  "ID"
]);
export function bridgeVirtualAccountCurrenciesForCountry(countryCode: unknown): string[] {
  if (!countryCode || isBridgeBlocked(countryCode)) return [];
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return [];
  const currencies = [];
  if (!BRIDGE_VA_NO_US_RAIL.has(upper)) currencies.push("USD");
  if (!BRIDGE_VA_NO_SEPA_FPS_RAIL.has(upper)) currencies.push("EUR", "GBP");
  return currencies;
}
export function isBridgeVirtualAccountCurrencyAvailable(countryCode: unknown, currency: unknown): boolean {
  if (!currency) return false;
  return bridgeVirtualAccountCurrenciesForCountry(countryCode).includes(String(currency).toUpperCase());
}
export function isBridgeCustodialWalletSupported(countryCode: unknown): boolean {
  if (!countryCode || isBridgeBlocked(countryCode)) return false;
  const upper = normalizeBridgeCountryCode(countryCode);
  return !!upper && !BRIDGE_CUSTODIAL_WALLET_UNSUPPORTED_COUNTRIES.has(upper);
}
export function bridgeCountryTier(countryCode: unknown): "prohibited" | "unavailable" | "controlled" | "supported" {
  const upper = normalizeBridgeCountryCode(countryCode);
  if (!upper) return "supported";
  if (BRIDGE_PROHIBITED_COUNTRIES.has(upper)) return "prohibited";
  if (BRIDGE_UNAVAILABLE_COUNTRIES.has(upper)) return "unavailable";
  if (BRIDGE_CONTROLLED_COUNTRIES.has(upper)) return "controlled";
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
 *  fire for them). */ export function bridgeCountryBlockResponse(countryCode: unknown) {
  const upper = normalizeBridgeCountryCode(countryCode) || String(countryCode || "").toUpperCase();
  const tier = bridgeCountryTier(upper);
  // Tier is narrowed to the blocked tiers because callers should only
  // invoke this after isBridgeBlocked returned true; the fallback
  // 'prohibited' default is just for type safety.
  const reason = tier === "unavailable" ? "unavailable" : "prohibited";
  return {
    success: false,
    code: "country_not_supported",
    error: reason === "unavailable" ? `${humanCountry(upper)} is not currently serviceable by BorderPay.` : `${humanCountry(upper)} support is not available through BorderPay.`,
    country: upper,
    reason
  };
}
/** Side-effectful structured log for observability. Call this alongside
 *  isBridgeBlocked in every Bridge edge function so the compliance owner
 *  can spot Controlled-country traffic in Supabase Edge logs.
 *
 *  Emits no output for Prohibited (already blocked + logged elsewhere)
 *  or Supported. Only fires for Controlled / High Risk countries.
 *
 *  Format is grep-friendly: `bridge_controlled_country fn=<…> country=<…> user_id=<…>`. */ export function logControlledBridgeTraffic(fn: string, countryCode: string | null | undefined, userId?: string | null): void {
  if (!countryCode) return;
  const upper = countryCode.toUpperCase();
  if (!BRIDGE_CONTROLLED_COUNTRIES.has(upper)) return;
  console.warn(`bridge_controlled_country fn=${fn} country=${upper} user_id=${userId ?? "anon"} ` + `policy=high_risk_no_block awaiting_approval_letter=true`);
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
export const AFRICAN_PAYOUT_COUNTRIES = new Set([
  "DZ",
  "AO",
  "BJ",
  "BW",
  "BF",
  "BI",
  "CM",
  "CV",
  "CF",
  "TD",
  "KM",
  "CG",
  "CD",
  "CI",
  "DJ",
  "EG",
  "GQ",
  "ER",
  "SZ",
  "ET",
  "GA",
  "GM",
  "GH",
  "GN",
  "GW",
  "KE",
  "LS",
  "LR",
  "LY",
  "MG",
  "MW",
  "ML",
  "MR",
  "MU",
  "MA",
  "MZ",
  "NA",
  "NE",
  "NG",
  "RW",
  "ST",
  "SN",
  "SC",
  "SL",
  "SO",
  "ZA",
  "SS",
  "SD",
  "TZ",
  "TG",
  "TN",
  "UG",
  "ZM",
  "ZW"
]);
export function isAfricanPayoutCountry(countryCode: unknown): boolean {
  return AFRICAN_PAYOUT_COUNTRIES.has(String(countryCode ?? "").trim().toUpperCase());
}
