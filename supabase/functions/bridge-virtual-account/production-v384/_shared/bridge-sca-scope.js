// Preserved production v384 module. See PROVENANCE.json before changing this graph.
import { loadAndAssertBridgeIdentityInvariant } from "./bridge-identity-invariant.js";
/** EU-27 plus Iceland, Liechtenstein and Norway. */
export const BRIDGE_EEA_SCA_COUNTRIES = new Set([
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
    "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL",
    "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);
const EEA_ISO3_TO_ISO2 = {
    AUT: "AT", BEL: "BE", BGR: "BG", HRV: "HR", CYP: "CY", CZE: "CZ",
    DNK: "DK", EST: "EE", FIN: "FI", FRA: "FR", DEU: "DE", GRC: "GR",
    HUN: "HU", ISL: "IS", IRL: "IE", ITA: "IT", LVA: "LV", LIE: "LI",
    LTU: "LT", LUX: "LU", MLT: "MT", NLD: "NL", NOR: "NO", POL: "PL",
    PRT: "PT", ROU: "RO", SVK: "SK", SVN: "SI", ESP: "ES", SWE: "SE",
};
const NON_EEA_ISO3_TO_ISO2 = {
    GBR: "GB", UKR: "UA", CHE: "CH", USA: "US", CAN: "CA", AUS: "AU",
    NZL: "NZ", KEN: "KE", ZAF: "ZA", NGA: "NG", GHA: "GH",
};
export function normalizeBridgeScaCountry(value) {
    const code = String(value ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code))
        return code;
    return EEA_ISO3_TO_ISO2[code]
        ?? NON_EEA_ISO3_TO_ISO2[code]
        ?? (/^[A-Z]{3}$/.test(code) ? code : null);
}
export function isBridgeEeaScaCountry(value) {
    const code = normalizeBridgeScaCountry(value);
    return code !== null && BRIDGE_EEA_SCA_COUNTRIES.has(code);
}
/**
 * Resolve the immutable legal jurisdiction from Bridge's customer record.
 * Businesses use incorporation/formation/registered jurisdiction and never
 * their operating address. Individuals use their residential address.
 * Browser, beneficiary and payout-account countries are never considered.
 */
function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function nestedCountry(value) {
    return normalizeBridgeScaCountry(objectValue(value).country);
}
export function bridgeCustomerScaCountry(customer, accountType) {
    const record = objectValue(customer);
    const data = objectValue(record.data ?? record);
    if (accountType === "business") {
        const business = objectValue(data.business ?? data.business_profile);
        return normalizeBridgeScaCountry(data.country_of_incorporation
            ?? data.incorporation_country
            ?? data.formation_country
            ?? business.country_of_incorporation
            ?? business.incorporation_country
            ?? business.formation_country) ?? nestedCountry(data.registered_address)
            ?? nestedCountry(business.registered_address);
    }
    return nestedCountry(data.residential_address)
        ?? nestedCountry(data.address)
        ?? normalizeBridgeScaCountry(data.country ?? data.country_code);
}
async function bridgeScaFetch(path) {
    const apiKey = Deno.env.get("BRIDGE_API_KEY") ?? "";
    if (!apiKey)
        throw new Error("bridge_api_key_missing");
    const baseUrl = (Deno.env.get("BRIDGE_BASE_URL") || "https://api.bridge.xyz").replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(`${baseUrl}${path}`, {
            headers: { "Api-Key": apiKey, Accept: "application/json", "User-Agent": "borderpay-sca/1.0" },
            signal: controller.signal,
        });
        if (!response.ok)
            throw new Error(`bridge_http_${response.status}`);
        return await response.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function loadBridgeScaCustomerSnapshot(customerId) {
    const encoded = encodeURIComponent(customerId);
    const [customerResponse, walletsResponse] = await Promise.all([
        bridgeScaFetch(`/v0/customers/${encoded}`),
        bridgeScaFetch(`/v0/customers/${encoded}/wallets?limit=100`),
    ]);
    const customerEnvelope = objectValue(customerResponse);
    const customer = objectValue(customerEnvelope.data ?? customerEnvelope);
    const walletEnvelope = objectValue(walletsResponse);
    const walletData = walletEnvelope.data ?? walletsResponse;
    const walletRows = Array.isArray(walletData)
        ? walletData
        : Array.isArray(objectValue(walletData).wallets) ? objectValue(walletData).wallets : [];
    return {
        raw: customer,
        wallets: walletRows.map((wallet) => {
            const row = objectValue(wallet);
            return { wallet_id: row.id ?? row.wallet_id, status: row.status };
        }),
    };
}
export function bridgeEeaScaEnforcementEnabled() {
    return Deno.env.get("BRIDGE_EEA_SCA_ENFORCEMENT_ENABLED") === "true";
}
export function bridgeEeaPilotAccessRequired() {
    return Deno.env.get("BRIDGE_EEA_PILOT_ACCESS_REQUIRED") === "true";
}
export function bridgeEeaPilotEmailAllowed(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized)
        return false;
    const configured = [
        Deno.env.get("BRIDGE_EEA_PILOT_EMAILS") || "",
        Deno.env.get("BRIDGE_EEA_PILOT_APPROVED_EMAILS") || "",
        Deno.env.get("BRIDGE_EEA_PILOT_CONFIRMED_EMAILS") || "",
    ].join(",");
    return new Set(configured.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)).has(normalized);
}
/**
 * Controlled rollout rule: every Bridge-KYB-approved business may use the EEA
 * SCA flow. Individual accounts remain restricted to the explicit pilot list.
 */
export function bridgeEeaPilotAccessAllowed(input) {
    const isApprovedBusiness = String(input.accountType || "").toLowerCase() === "business" &&
        String(input.verificationStatus || "").toLowerCase() === "approved";
    return isApprovedBusiness || bridgeEeaPilotEmailAllowed(input.email);
}
const TERMINAL_WALLET_STATUSES = new Set(["closed", "deleted", "disabled", "deactivated", "inactive"]);
export function isActiveBridgeCustodialWallet(wallet) {
    if (!String(wallet.wallet_id ?? "").trim())
        return false;
    return !TERMINAL_WALLET_STATUSES.has(String(wallet.status ?? "").trim().toLowerCase());
}
async function resolveStoredScopeFallback(supabase, userId, accountType, storedCountry, verified) {
    const country = normalizeBridgeScaCountry(storedCountry);
    if (!country)
        return null;
    if (!isBridgeEeaScaCountry(country)) {
        return { account_type: accountType, required: false, status: "not_required", reason: "non_eea", country, verified, has_custodial_wallet: null };
    }
    const ownerFilter = accountType === "business"
        ? `business_user_id.eq.${userId},user_id.eq.${userId}`
        : `user_id.eq.${userId}`;
    const { data, error } = await supabase
        .from("bridge_wallets")
        .select("bridge_wallet_id,status")
        .or(ownerFilter);
    if (error)
        return null;
    const hasCustodialWallet = (Array.isArray(data) ? data : []).some((wallet) => isActiveBridgeCustodialWallet({ wallet_id: wallet.bridge_wallet_id, status: wallet.status }));
    return hasCustodialWallet
        ? { account_type: accountType, required: true, status: "required", reason: "verified_eea_custodial_wallet", country, verified, has_custodial_wallet: true }
        : { account_type: accountType, required: false, status: "not_required", reason: "no_custodial_wallet", country, verified, has_custodial_wallet: false };
}
async function readFreshProviderScope(supabase, userId, customerId, accountType) {
    const { data, error } = await supabase
        .from("sca_customer_scopes")
        .select("provider_country,sca_required,expires_at")
        .eq("user_id", userId)
        .eq("bridge_customer_id", customerId)
        .eq("source", "bridge_customer_api")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
    if (error || !data)
        return null;
    const country = normalizeBridgeScaCountry(data.provider_country);
    if (!country)
        return null;
    // Recheck EEA/no-wallet results because wallet creation changes scope.
    if (isBridgeEeaScaCountry(country) && data.sca_required !== true)
        return null;
    return {
        account_type: accountType,
        required: data.sca_required === true,
        status: data.sca_required === true ? "required" : "not_required",
        reason: "provider_scope_cache",
        country,
        verified: true,
        has_custodial_wallet: data.sca_required === true ? true : null,
    };
}
async function storeProviderScope(supabase, userId, customerId, country, required) {
    const checkedAt = new Date();
    const ttlMinutes = required || !isBridgeEeaScaCountry(country) ? 24 * 60 : 5;
    const { error } = await supabase.from("sca_customer_scopes").upsert({
        user_id: userId,
        bridge_customer_id: customerId,
        provider_country: country,
        sca_required: required,
        source: "bridge_customer_api",
        checked_at: checkedAt.toISOString(),
        expires_at: new Date(checkedAt.getTime() + ttlMinutes * 60_000).toISOString(),
        updated_at: checkedAt.toISOString(),
    }, { onConflict: "user_id" });
    if (error)
        console.warn("bridge_sca_scope_cache_write_failed", { user_id: userId, code: error.code });
}
/** Resolve SCA from Bridge-authoritative customer country and custodial wallets. */
export async function resolveBridgeScaScope(supabase, userId) {
    const identity = await loadAndAssertBridgeIdentityInvariant(supabase, userId);
    if (!identity.ok) {
        return { account_type: null, required: false, status: "unknown", reason: "identity_invariant_violation", country: null, verified: false, has_custodial_wallet: null };
    }
    const customerId = identity.context.bridge_customer_id;
    const verified = identity.context.verification_status === "approved";
    if (!verified)
        return { account_type: identity.context.account_type, required: false, status: "not_required", reason: "not_verified", country: null, verified, has_custodial_wallet: null };
    if (!customerId)
        return { account_type: identity.context.account_type, required: false, status: "unknown", reason: "no_bridge_customer", country: null, verified, has_custodial_wallet: null };
    const cached = await readFreshProviderScope(supabase, userId, customerId, identity.context.account_type);
    if (cached)
        return cached;
    const storedFallback = () => resolveStoredScopeFallback(supabase, userId, identity.context.account_type, identity.context.country, verified);
    try {
        const snapshot = await loadBridgeScaCustomerSnapshot(customerId);
        const country = bridgeCustomerScaCountry(snapshot.raw, identity.context.account_type);
        if (!country) {
            return await storedFallback()
                ?? { account_type: identity.context.account_type, required: false, status: "unknown", reason: "bridge_scope_unavailable", country: null, verified, has_custodial_wallet: null };
        }
        if (!isBridgeEeaScaCountry(country)) {
            await storeProviderScope(supabase, userId, customerId, country, false);
            return { account_type: identity.context.account_type, required: false, status: "not_required", reason: "non_eea", country, verified, has_custodial_wallet: null };
        }
        const hasCustodialWallet = snapshot.wallets.some(isActiveBridgeCustodialWallet);
        await storeProviderScope(supabase, userId, customerId, country, hasCustodialWallet);
        if (!hasCustodialWallet) {
            return { account_type: identity.context.account_type, required: false, status: "not_required", reason: "no_custodial_wallet", country, verified, has_custodial_wallet: false };
        }
        return { account_type: identity.context.account_type, required: true, status: "required", reason: "verified_eea_custodial_wallet", country, verified, has_custodial_wallet: true };
    }
    catch (error) {
        console.error("bridge_sca_scope_resolution_failed", { user_id: userId, error: error instanceof Error ? error.message : "unknown" });
        return await storedFallback()
            ?? { account_type: identity.context.account_type, required: false, status: "unknown", reason: "bridge_scope_unavailable", country: null, verified, has_custodial_wallet: null };
    }
}
