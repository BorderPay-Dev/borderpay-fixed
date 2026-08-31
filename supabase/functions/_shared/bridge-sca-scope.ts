import { loadAndAssertBridgeIdentityInvariant } from "./bridge-identity-invariant.ts";
import { bridgeProvider } from "./providers/bridge.ts";

/**
 * Bridge SCA applies to custodial-wallet customers legally resident/operating
 * in the EEA. This is deliberately separate from Bridge's product-eligibility
 * country lists: the EEA includes Iceland, Liechtenstein and Norway, and does
 * not include the United Kingdom or Switzerland.
 */
export const BRIDGE_EEA_SCA_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
  "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL",
  "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const EEA_ISO3_TO_ISO2: Readonly<Record<string, string>> = {
  AUT: "AT", BEL: "BE", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ",
  DNK: "DK", EST: "EE", FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR",
  HUN: "HU", ISL: "IS", IRL: "IE", ITA: "IT", LVA: "LV", LIE: "LI",
  LTU: "LT", LUX: "LU", MLT: "MT", NLD: "NL", NOR: "NO", POL: "PL",
  PRT: "PT", ROU: "RO", SVK: "SK", SVN: "SI", ESP: "ES", SWE: "SE",
};

type SupaLike = { from: (table: string) => any };

export type BridgeScaScope = {
  required: boolean;
  status: "required" | "not_required" | "unknown";
  reason:
    | "verified_eea_custodial_wallet"
    | "not_verified"
    | "no_bridge_customer"
    | "non_eea"
    | "no_custodial_wallet"
    | "identity_invariant_violation"
    | "bridge_scope_unavailable";
  country: string | null;
  verified: boolean;
  has_custodial_wallet: boolean | null;
};

export function normalizeBridgeScaCountry(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  return EEA_ISO3_TO_ISO2[code] ?? (/^[A-Z]{3}$/.test(code) ? code : null);
}

export function isBridgeEeaScaCountry(value: unknown): boolean {
  const code = normalizeBridgeScaCountry(value);
  return code !== null && BRIDGE_EEA_SCA_COUNTRIES.has(code);
}

/**
 * Make the cheapest authoritative decision from server-controlled onboarding
 * data. A verified, explicitly non-EEA profile must never lose account access
 * because Bridge's profile API is slow or temporarily unavailable. EEA and
 * missing-country profiles continue to Bridge for confirmation.
 */
export function resolveLocalBridgeScaScope(
  verificationStatus: unknown,
  countryValue: unknown,
): BridgeScaScope | null {
  const verified = String(verificationStatus ?? '').trim().toLowerCase() === 'approved';
  const country = normalizeBridgeScaCountry(countryValue);
  if (!verified) {
    return { required: false, status: "not_required", reason: "not_verified", country, verified: false, has_custodial_wallet: null };
  }
  if (country && !BRIDGE_EEA_SCA_COUNTRIES.has(country)) {
    return { required: false, status: "not_required", reason: "non_eea", country, verified: true, has_custodial_wallet: null };
  }
  return null;
}

/**
 * Resolve SCA scope from authoritative server-side identity and Bridge data.
 * Browser country/profile metadata is never accepted as authority.
 */
export async function resolveBridgeScaScope(
  supabase: SupaLike,
  userId: string,
): Promise<BridgeScaScope> {
  const identity = await loadAndAssertBridgeIdentityInvariant(supabase, userId);
  if (!identity.ok) {
    return {
      required: false,
      status: "unknown",
      reason: "identity_invariant_violation",
      country: null,
      verified: false,
      has_custodial_wallet: null,
    };
  }

  const { bridge_customer_id: customerId, verification_status: verificationStatus, country: localCountry } = identity.context;
  const localDecision = resolveLocalBridgeScaScope(verificationStatus, localCountry);
  if (localDecision) return localDecision;
  const verified = true;
  if (!customerId) {
    return { required: false, status: "unknown", reason: "no_bridge_customer", country: null, verified, has_custodial_wallet: null };
  }

  try {
    const customer = await bridgeProvider.getCustomerProfile(customerId);
    const country = normalizeBridgeScaCountry(customer.country);
    if (!country) {
      return { required: false, status: "unknown", reason: "bridge_scope_unavailable", country: null, verified, has_custodial_wallet: null };
    }
    if (!BRIDGE_EEA_SCA_COUNTRIES.has(country)) {
      return { required: false, status: "not_required", reason: "non_eea", country, verified, has_custodial_wallet: null };
    }
    const wallets = await bridgeProvider.listWallets(customerId);
    const hasCustodialWallet = wallets.some((wallet) => Boolean(wallet.wallet_id));
    if (!hasCustodialWallet) {
      return { required: false, status: "not_required", reason: "no_custodial_wallet", country, verified, has_custodial_wallet: false };
    }
    return {
      required: true,
      status: "required",
      reason: "verified_eea_custodial_wallet",
      country,
      verified,
      has_custodial_wallet: true,
    };
  } catch (error) {
    console.error("bridge_sca_scope_resolution_failed", {
      user_id: userId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { required: false, status: "unknown", reason: "bridge_scope_unavailable", country: null, verified, has_custodial_wallet: null };
  }
}
