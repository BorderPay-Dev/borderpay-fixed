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

const FLW_PAYOUT_ENABLED = (Deno.env.get("FLW_PAYOUT_ENABLED") || "").toLowerCase() === "true";
const FLW_SUPPORTED_COUNTRIES = new Set(["NG", "KE", "GH", "UG", "TZ", "RW", "ZM", "ZA"]);
const FLW_SUPPORTED_CURRENCIES = new Set(["NGN", "KES", "GHS", "UGX", "TZS", "RWF", "ZMW", "ZAR"]);

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
 * Stage-0 Flutterwave routing helper (not yet wired into live transfer
 * execution): returns true only when payout rails are enabled and the
 * destination country/currency are explicitly in our allowlist.
 */
export function canUseFlutterwaveLocalRail(input: {
  destinationCountry: string | null | undefined;
  destinationCurrency: string | null | undefined;
  method: AfricanLocalMethod;
}): boolean {
  if (!FLW_PAYOUT_ENABLED) return false;
  const country = String(input.destinationCountry || "").trim().toUpperCase();
  const currency = String(input.destinationCurrency || "").trim().toUpperCase();
  if (!country || !currency) return false;
  if (!FLW_SUPPORTED_COUNTRIES.has(country)) return false;
  if (!FLW_SUPPORTED_CURRENCIES.has(currency)) return false;
  // Both bank and mobile_money are supported in the adapter scaffold;
  // final per-corridor enablement remains server-config controlled.
  return input.method === "bank" || input.method === "mobile_money";
}
