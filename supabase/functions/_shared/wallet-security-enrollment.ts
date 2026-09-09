import { isBridgeEeaScaCountry, normalizeBridgeScaCountry } from "./bridge-sca-scope.ts";
import { bridgeProvider } from "./providers/bridge.ts";

type SupabaseLike = { from: (table: string) => any };

export type WalletSecurityEnrollment = {
  required: boolean;
  country: string | null;
  enrolled: boolean;
  pin_enrolled: boolean;
  totp_enrolled: boolean;
  missing: Array<"transaction_pin" | "authenticator">;
};

export function bridgeEeaWalletSecurityRequired(country: unknown): boolean {
  return isBridgeEeaScaCountry(country);
}

/**
 * Provider-resource creation requires both durable server-side factors.
 * Client caches and profile mirror flags are deliberately not accepted.
 */
export async function loadWalletSecurityEnrollment(
  supabase: SupabaseLike,
  userId: string,
): Promise<WalletSecurityEnrollment> {
  const { data, error } = await supabase
    .from("user_security")
    .select("pin_set,pin_hash,pin_hash_v2,two_factor_enabled,two_factor_secret_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`wallet security enrollment lookup failed: ${error.message}`);
  }

  const pinEnrolled = data?.pin_set === true && Boolean(
    String(data?.pin_hash_v2 || "").trim() || String(data?.pin_hash || "").trim(),
  );
  const encryptedTotp = data?.two_factor_secret_encrypted;
  const totpEnrolled = data?.two_factor_enabled === true && (
    (typeof encryptedTotp === "string" && encryptedTotp.trim().length > 0) ||
    (Array.isArray(encryptedTotp) && encryptedTotp.length > 0) ||
    encryptedTotp instanceof Uint8Array
  );
  const missing: WalletSecurityEnrollment["missing"] = [];
  if (!pinEnrolled) missing.push("transaction_pin");
  if (!totpEnrolled) missing.push("authenticator");

  return {
    required: true,
    country: null,
    enrolled: missing.length === 0,
    pin_enrolled: pinEnrolled,
    totp_enrolled: totpEnrolled,
    missing,
  };
}

/** Resolve the enrollment requirement from Bridge's customer country. */
export async function loadBridgeEeaWalletSecurityEnrollment(
  supabase: SupabaseLike,
  userId: string,
  bridgeCustomerId: string,
): Promise<WalletSecurityEnrollment> {
  const customer = await bridgeProvider.getCustomerProfile(bridgeCustomerId);
  const country = normalizeBridgeScaCountry(customer.country);
  if (!country) throw new Error("Bridge customer country is unavailable");
  if (!bridgeEeaWalletSecurityRequired(country)) {
    return {
      required: false,
      country,
      enrolled: true,
      pin_enrolled: false,
      totp_enrolled: false,
      missing: [],
    };
  }
  const enrollment = await loadWalletSecurityEnrollment(supabase, userId);
  return { ...enrollment, required: true, country };
}

export function walletSecurityEnrollmentResponse(enrollment: WalletSecurityEnrollment) {
  return {
    success: false,
    code: "security_enrollment_required",
    error: "Set up your transaction PIN and authenticator before requesting a wallet or virtual account.",
    required: ["transaction_pin", "authenticator"],
    missing: enrollment.missing,
    country: enrollment.country,
  };
}
