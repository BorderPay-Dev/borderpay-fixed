import { ISO2_COUNTRIES, ISO3_TO_ISO2 } from "./iso-country-codes.ts";
import { loadAndAssertBridgeIdentityInvariant } from "./bridge-identity-invariant.ts";
import { bridgeProvider, BridgeProviderError } from "./providers/bridge.ts";

/** The 30 EEA states. The UK and Switzerland are deliberately excluded. */
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
    | "eea_payment"
    | "not_verified"
    | "no_bridge_customer"
    | "non_eea"
    | "no_custodial_wallet"
    | "identity_invariant_violation"
    | "bridge_scope_unavailable"
    | "business_incorporation_country_unavailable";
  diagnostic_code?: string;
  country: string | null;
  verified: boolean;
  has_custodial_wallet: boolean | null;
};

export function normalizeBridgeScaCountry(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  if (ISO2_COUNTRIES.has(code)) return code;
  return EEA_ISO3_TO_ISO2[code]
    ?? ISO3_TO_ISO2[code]
    ?? null;
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

/** Businesses use incorporation country only; individuals use residence. */
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

const TERMINAL_WALLET_STATUSES = new Set(["closed", "deleted", "disabled", "deactivated", "inactive"]);

export function isActiveBridgeCustodialWallet(wallet: { wallet_id?: unknown; status?: unknown }): boolean {
  if (!String(wallet.wallet_id ?? "").trim()) return false;
  const status = String(wallet.status ?? "").trim().toLowerCase();
  return !TERMINAL_WALLET_STATUSES.has(status);
}

/** Scope is derived only from authoritative Bridge identity data. */
export async function resolveBridgeScaScope(
  supabase: SupaLike, userId: string, purpose: "access" | "payment" = "access",
): Promise<BridgeScaScope> {
  const identity = await loadAndAssertBridgeIdentityInvariant(supabase, userId);
  return resolveScopeForIdentity(identity, purpose, userId);
}

async function resolveScopeForIdentity(
  identity: Awaited<ReturnType<typeof loadAndAssertBridgeIdentityInvariant>>,
  purpose: "access" | "payment",
  userId: string,
): Promise<BridgeScaScope> {
  if (!identity.ok) {
    return { required: false, status: "unknown", reason: "identity_invariant_violation", diagnostic_code: identity.failure.reason, country: null, verified: false, has_custodial_wallet: null };
  }

  const { bridge_customer_id: customerId, verification_status: verificationStatus } = identity.context;
  const verified = verificationStatus === "approved";
  if (!verified) return { required: false, status: "not_required", reason: "not_verified", country: null, verified, has_custodial_wallet: null };
  if (!customerId) return { required: false, status: "unknown", reason: "no_bridge_customer", country: null, verified, has_custodial_wallet: null };

  try {
    // For businesses, `business_profiles.country` is the mandatory country of
    // incorporation collected at signup. It is the scope source of truth; an
    // operating address and a changing provider response shape must never
    // change the business's EEA classification.
    const resolvedCountry = identity.context.account_type === "business"
      ? normalizeBridgeScaCountry(identity.context.country)
      : bridgeCustomerScaCountry(
          await bridgeProvider.getCustomerProfile(customerId),
          "individual",
        );
    if (!resolvedCountry) {
      return {
        required: false,
        status: "unknown",
        reason: identity.context.account_type === "business"
          ? "business_incorporation_country_unavailable"
          : "bridge_scope_unavailable",
        diagnostic_code: "authoritative_country_missing",
        country: null,
        verified,
        has_custodial_wallet: null,
      };
    }
    if (!BRIDGE_EEA_SCA_COUNTRIES.has(resolvedCountry)) {
      return { required: false, status: "not_required", reason: "non_eea", country: resolvedCountry, verified, has_custodial_wallet: null };
    }
    // A payout cannot use a missing/stale wallet listing as an SCA exemption.
    // Access/provisioning callers still need the inventory-based scope.
    if (purpose === "payment") {
      return { required: true, status: "required", reason: "eea_payment", country: resolvedCountry, verified, has_custodial_wallet: null };
    }
    const wallets = await bridgeProvider.listWallets(customerId);
    const hasCustodialWallet = wallets.some(isActiveBridgeCustodialWallet);
    if (!hasCustodialWallet) {
      return { required: false, status: "not_required", reason: "no_custodial_wallet", country: resolvedCountry, verified, has_custodial_wallet: false };
    }
    return { required: true, status: "required", reason: "verified_eea_custodial_wallet", country: resolvedCountry, verified, has_custodial_wallet: true };
  } catch (error) {
    console.error("bridge_sca_scope_resolution_failed", { user_id: userId, error: error instanceof Error ? error.message : "unknown" });
    return { required: false, status: "unknown", reason: "bridge_scope_unavailable",
      diagnostic_code: error instanceof BridgeProviderError
        ? (error.status ? `bridge_http_${error.status}` : "bridge_transport_or_configuration_error")
        : "scope_resolution_internal_error",
      country: null, verified, has_custodial_wallet: null };
  }
}

/** Product eligibility is independent of wallet inventory and SCA enrollment. */
export async function resolveBridgeWalletAssetScope(supabase: SupaLike, userId: string, options: { forceRefresh?: boolean } = {}) {
  const identity = await loadAndAssertBridgeIdentityInvariant(supabase, userId);
  // Read-only asset visibility uses the same unexpired provider observation as
  // RLS. Payment SCA continues to resolve independently on every authorization.
  if (!options.forceRefresh && identity.ok && identity.context.account_type === "individual"
    && identity.context.verification_status === "approved" && identity.context.bridge_customer_id) {
    const { data: cached, error } = await supabase.from("sca_customer_scopes")
      .select("bridge_customer_id,provider_country,source,checked_at,expires_at")
      .eq("user_id", userId)
      .eq("bridge_customer_id", identity.context.bridge_customer_id)
      .eq("source", "bridge_customer_api")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    const country = normalizeBridgeScaCountry(cached?.provider_country);
    const now = Date.now();
    if (!error && country && cached?.bridge_customer_id === identity.context.bridge_customer_id
      && cached?.source === "bridge_customer_api" && Date.parse(cached?.checked_at) <= now
      && Date.parse(cached?.expires_at) > now) {
      const eea = isBridgeEeaScaCountry(country);
      return { region: eea ? "eea" as const : "non_eea" as const,
        allow_eurc_base: eea, allow_usdt_tron: !eea, country,
        reason: eea ? "eea_asset_scope" : "non_eea" };
    }
  }
  const scope = await resolveScopeForIdentity(identity, "payment", userId);
  const known = scope.status !== "unknown" && scope.verified && Boolean(scope.country);
  const eea = known && isBridgeEeaScaCountry(scope.country);
  const nonEea = known && scope.reason === "non_eea";
  if (known) {
    if (!identity.ok) return { region: "unknown" as const, allow_eurc_base: false, allow_usdt_tron: false, country: null, reason: "identity_invariant_violation" };
    if (identity.context.account_type === "individual") {
      // RLS reads the same provider-confirmed residence. Publish this fresh
      // observation before the client reads wallets/ledger, never after them.
      const now = new Date();
      const { error } = await supabase.from("sca_customer_scopes").upsert({
        user_id: userId, bridge_customer_id: identity.context.bridge_customer_id,
        provider_country: scope.country, sca_required: eea, source: "bridge_customer_api",
        checked_at: now.toISOString(), expires_at: new Date(now.getTime() + 60 * 60_000).toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: "user_id" });
      if (error) return { region: "unknown" as const, allow_eurc_base: false, allow_usdt_tron: false, country: null, reason: "scope_cache_unavailable" };
    }
  }

  return {
    region: eea ? "eea" as const : nonEea ? "non_eea" as const : "unknown" as const,
    allow_eurc_base: eea,
    allow_usdt_tron: nonEea,
    country: scope.country,
    reason: scope.reason,
    ...(scope.diagnostic_code ? { diagnostic_code: scope.diagnostic_code } : {}),
  };
}
