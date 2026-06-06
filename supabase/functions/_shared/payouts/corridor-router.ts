/**
 * Payout corridor router (#B1).
 *
 * Classifies a payout by destination country and selects the settlement route:
 *   • International (US / EU / LatAm / rest-of-world) → bridge_payout (our
 *     international payout API).
 *   • African destination → african_aggregator (localized aggregator module).
 *
 * Pure + provider-agnostic. The withdrawal/payout workflow calls this to decide
 * which executor to invoke. The provider behind "bridge_payout" is never named
 * to users.
 */

import { isAfricanPayoutCountry } from "../providers/bridge-country-policy.ts";

export type Corridor    = "international" | "african";
export type PayoutRoute  = "bridge_payout" | "african_aggregator";

export function classifyCorridor(destinationCountry: string | null | undefined): Corridor {
  return isAfricanPayoutCountry(destinationCountry) ? "african" : "international";
}

export function selectPayoutRoute(corridor: Corridor): PayoutRoute {
  return corridor === "african" ? "african_aggregator" : "bridge_payout";
}

export function routeForCountry(destinationCountry: string | null | undefined): PayoutRoute {
  return selectPayoutRoute(classifyCorridor(destinationCountry));
}
