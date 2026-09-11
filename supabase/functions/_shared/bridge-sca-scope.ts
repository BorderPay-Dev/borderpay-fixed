import { loadAndAssertBridgeIdentityInvariant } from "./bridge-identity-invariant.ts";
import { bridgeProvider } from "./providers/bridge.ts";

/**
 * Bridge SCA applies to custodial-wallet individuals resident in the EEA and
 * businesses legally incorporated in the EEA. This is deliberately separate from Bridge's product-eligibility
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
    | "bridge_scope_unavailable"
    | "business_incorporation_country_unavailable";
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

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function firstCountry(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeBridgeScaCountry(value);
    if (normalized && normalized.length === 2) return normalized;
  }
  return null;
}

/** Business uses incorporation country only; individuals use residence. */
export function bridgeCustomerScaCountry(customer: any, accountType: "business" | "individual"): string | null {
  const envelope = asRecord(customer?.raw);
  const data = asRecord(envelope.data || envelope);
  if (accountType === "business") {
    const business = asRecord(data.business);
    const registeredAddress = asRecord(
      business.registered_address || data.registered_address || data.business_registered_address,
    );
    return firstCountry(
      business.country_of_incorporation,
      data.country_of_incorporation,
      business.incorporation_country,
      data.incorporation_country,
      business.formation_country,
      data.formation_country,
      registeredAddress.country,
    );
  }
  const residentialAddress = asRecord(data.residential_address);
  return firstCountry(residentialAddress.country, data.country_of_residence, data.residence_country, customer?.country);
}

export function bridgeEeaScaEnforcementEnabled(): boolean {
  return Deno.env.get("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED") === "true";
}

export function bridgeEeaPilotAccessRequired(): boolean {
  return Deno.env.get("BRIDGE_EEA_PILOT_ACCESS_REQUIRED") === "true";
}

export function bridgeEeaPilotEmailAllowed(email: unknown): boolean {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  const configured = [
    Deno.env.get("BRIDGE_EEA_PILOT_EMAILS") || "",
    Deno.env.get("BRIDGE_EEA_PILOT_APPROVED_EMAILS") || "",
  ].join(",");
  return new Set(
    configured
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ).has(normalized);
}

const TERMINAL_WALLET_STATUSES = new Set(["closed", "deleted", "disabled", "deactivated", "inactive"]);

export function isActiveBridgeCustodialWallet(wallet: { wallet_id?: unknown; status?: unknown }): boolean {
  if (!String(wallet.wallet_id ?? "").trim()) return false;
  const status = String(wallet.status ?? "").trim().toLowerCase();
  // Bridge historically omitted status from list responses. A returned wallet
  // remains in scope unless Bridge explicitly reports a terminal state.
  return !TERMINAL_WALLET_STATUSES.has(status);
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

  const { bridge_customer_id: customerId, verification_status: verificationStatus } = identity.context;
  const verified = verificationStatus === "approved";
  if (!verified) {
    return { required: false, status: "not_required", reason: "not_verified", country: null, verified, has_custodial_wallet: null };
  }
  if (!customerId) {
    return { required: false, status: "unknown", reason: "no_bridge_customer", country: null, verified, has_custodial_wallet: null };
  }

  try {
    const customer = await bridgeProvider.getCustomerProfile(customerId);
    const country = bridgeCustomerScaCountry(customer, identity.context.account_type);
    if (!country) {
      if (identity.context.account_type === "business") {
        return { required: false, status: "not_required", reason: "business_incorporation_country_unavailable", country: null, verified, has_custodial_wallet: null };
      }
      return {
        required: false,
        status: "unknown",
        reason: "bridge_scope_unavailable",
        country: null,
        verified,
        has_custodial_wallet: null,
      };
    }
    if (!BRIDGE_EEA_SCA_COUNTRIES.has(country)) {
      return { required: false, status: "not_required", reason: "non_eea", country, verified, has_custodial_wallet: null };
    }
    // Custodial-wallet presence is relevant only after an authoritative EEA
    // country match. Avoiding this second provider call for non-EEA customers
    // keeps billing and access checks inside provider rate limits.
    const wallets = await bridgeProvider.listWallets(customerId);
    const hasCustodialWallet = wallets.some(isActiveBridgeCustodialWallet);
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
