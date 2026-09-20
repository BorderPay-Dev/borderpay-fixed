// Preserved production v384 module. See PROVENANCE.json before changing this graph.
import { bridgeCustomerScaCountry, isBridgeEeaScaCountry, loadBridgeScaCustomerSnapshot } from "./bridge-sca-scope.js";
export function bridgeEeaWalletSecurityRequired(country) {
    return isBridgeEeaScaCountry(country);
}
/**
 * Provider-resource creation requires both durable server-side factors.
 * Client caches and profile mirror flags are deliberately not accepted.
 */ export async function loadWalletSecurityEnrollment(supabase, userId) {
    const { data, error } = await supabase.from("user_security").select("pin_set,pin_hash,pin_hash_v2,two_factor_enabled,two_factor_secret_encrypted").eq("user_id", userId).maybeSingle();
    if (error) {
        throw new Error(`wallet security enrollment lookup failed: ${error.message}`);
    }
    const pinEnrolled = data?.pin_set === true && Boolean(String(data?.pin_hash_v2 || "").trim() || String(data?.pin_hash || "").trim());
    const encryptedTotp = data?.two_factor_secret_encrypted;
    const totpEnrolled = data?.two_factor_enabled === true && (typeof encryptedTotp === "string" && encryptedTotp.trim().length > 0 || Array.isArray(encryptedTotp) && encryptedTotp.length > 0 || encryptedTotp instanceof Uint8Array);
    const missing = [];
    if (!pinEnrolled)
        missing.push("transaction_pin");
    if (!totpEnrolled)
        missing.push("authenticator");
    return {
        required: true,
        country: null,
        enrolled: missing.length === 0,
        pin_enrolled: pinEnrolled,
        totp_enrolled: totpEnrolled,
        missing
    };
}
/** Resolve enrollment from Bridge incorporation for businesses and residence for individuals. */
export async function loadBridgeEeaWalletSecurityEnrollment(supabase, userId, bridgeCustomerId) {
    const { data: profile, error: profileError } = await supabase.from("user_profiles").select("account_type").eq("id", userId).maybeSingle();
    if (profileError || !profile) {
        throw new Error(`SCA identity type lookup failed: ${profileError?.message || "profile missing"}`);
    }
    const customer = (await loadBridgeScaCustomerSnapshot(bridgeCustomerId)).raw;
    const accountType = profile.account_type === "business" ? "business" : "individual";
    const country = bridgeCustomerScaCountry(customer, accountType);
    if (!country) {
        if (accountType === "business") {
            return { required: false, country: null, enrolled: true, pin_enrolled: false, totp_enrolled: false, missing: [] };
        }
        throw new Error("Bridge customer residence country is unavailable");
    }
    if (!bridgeEeaWalletSecurityRequired(country)) {
        return {
            required: false,
            country,
            enrolled: true,
            pin_enrolled: false,
            totp_enrolled: false,
            missing: []
        };
    }
    const enrollment = await loadWalletSecurityEnrollment(supabase, userId);
    return {
        ...enrollment,
        required: true,
        country
    };
}
export function walletSecurityEnrollmentResponse(enrollment) {
    return {
        success: false,
        code: "security_enrollment_required",
        error: "Set up your transaction PIN and authenticator before requesting a wallet or virtual account.",
        required: [
            "transaction_pin",
            "authenticator"
        ],
        missing: enrollment.missing,
        country: enrollment.country
    };
}
