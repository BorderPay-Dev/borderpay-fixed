/**
 * Payout corridor router (#B1).
 *
 * Classifies a payout by destination country and selects the settlement route:
 *   • International (US / EU / LatAm / rest-of-world) → bridge_payout (our
 *     international fiat payout API).
 *   • African destination → stablecoin (native external USDT/USDC withdrawal
 *     over a supported network: TRON/Polygon/Solana/Arbitrum/Base). No local
 *     bank/aggregator partner is required — Bridge settles stablecoin natively.
 *
 * Pure + provider-agnostic. The provider behind "bridge_payout" is never named
 * to users.
 */

import { isAfricanPayoutCountry } from "../providers/bridge-country-policy.ts";

export type Corridor = "international" | "african";
export type PayoutRoute = "bridge_payout" | "stablecoin" | "flutterwave_local";

export type AfricanLocalMethod = "bank" | "mobile_money";

export function classifyCorridor(destinationCountry: string | null | undefined): Corridor {
  return isAfricanPayoutCountry(destinationCountry) ? "african" : "international";
}

export function selectPayoutRoute(corridor: Corridor): PayoutRoute {
  // African corridors settle via external stablecoin transfer; everything else
  // goes through the international fiat payout rail.
  return corridor === "african" ? "stablecoin" : "bridge_payout";
}

export function routeForCountry(destinationCountry: string | null | undefined): PayoutRoute {
  return selectPayoutRoute(classifyCorridor(destinationCountry));
}

/**
 * Legacy Stage-0 helper retained only for backwards compatibility.
 *
 * Do not use this helper for execution decisions.
 * All Flutterwave routing decisions now come from DB-backed
 * `provider_corridor_policy` enforcement in edge functions.
 */
export function canUseFlutterwaveLocalRail(input: {
  destinationCountry: string | null | undefined;
  destinationCurrency: string | null | undefined;
  method: AfricanLocalMethod;
}): boolean {
  void input;
  return false;
}
