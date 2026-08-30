/**
 * Yellow Card account-level sandbox enablement for BorderPay.
 *
 * Authority: Yellow Card account team confirmation to BorderPay, 2026-08-11.
 * This is intentionally narrower than the signed commercial schedule and the
 * global channel catalogue. A returned channel does not prove that BorderPay's
 * sandbox account may create transactions in that country.
 */
export const YELLOW_CARD_SANDBOX_ENABLED_COUNTRIES = [
  "NG", // Nigeria
  "CG", // Congo Brazzaville
  "CI", // Ivory Coast
  "RW", // Rwanda
  "KE", // Kenya
  "ZA", // South Africa
  "CM", // Cameroon
  "ZM", // Zambia
  "UG", // Uganda
  "TZ", // Tanzania
  "BW", // Botswana
  "BJ", // Benin
] as const;

const ENABLED = new Set<string>(YELLOW_CARD_SANDBOX_ENABLED_COUNTRIES);

export function isYellowCardSandboxCountryEnabled(countryCode: unknown): boolean {
  return ENABLED.has(String(countryCode || "").trim().toUpperCase());
}
