/**
 * Bridge country eligibility policy.
 *
 * Bridge publishes a list of supported / unsupported jurisdictions
 * (https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list).
 * Some African countries — notably the Democratic Republic of the Congo (COD)
 * — are categorised PROHIBITED with no US ACH / FedWire / SEPA / FPS support.
 *
 * BorderPay allows accounts for residents of these countries (auth and
 * profile creation are provider-neutral), but blocks Bridge customer
 * creation and money-movement flows server-side. The frontend surfaces a
 * future-state message; back-ends in bridge-customer / bridge-kyc-link /
 * bridge-kyb-link consult `isBridgeProhibited` before any Bridge call.
 *
 * This is NOT a complete model of Bridge's compliance matrix. It enumerates
 * countries we have explicitly committed to onboard via a future local-rails
 * partner. Other Bridge-restricted countries should also be added as we
 * confirm BorderPay product intent for them.
 */

/** ISO-3166 alpha-2 codes blocked from Bridge customer creation. */
export const BRIDGE_PROHIBITED_COUNTRIES: ReadonlySet<string> = new Set([
  "CD",   // Democratic Republic of the Congo — Bridge: Prohibited
]);

export function isBridgeProhibited(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return BRIDGE_PROHIBITED_COUNTRIES.has(countryCode.toUpperCase());
}

/**
 * Structured response payload returned by Bridge edge functions when a
 * user's country is on the prohibited list. The frontend (KYCVerification,
 * dashboard cards) renders the message as a future-state notice without
 * naming the eventual partner (Yativo) as live.
 */
export function bridgeCountryBlockResponse(countryCode: string) {
  return {
    success: false as const,
    code:    "country_not_supported",
    error:   `${humanCountry(countryCode)} support is coming through our African local rails partner.`,
    country: countryCode.toUpperCase(),
  };
}

function humanCountry(code: string): string {
  const u = code.toUpperCase();
  if (u === "CD") return "DRC";
  return u;
}
