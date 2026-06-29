/**
 * Bridge-safe rejection reason normalizer for customer emails.
 *
 * Source of truth:
 * https://apidocs.bridge.xyz/platform/customers/customers/rejection_reasons
 *
 * We must only surface customer-shareable rejection reasons and never expose
 * developer/internal rationale.
 */
export const BRIDGE_SAFE_REJECTION_DEFAULT = "Your information could not be verified";

const UNSAFE_PATTERNS = [
  /developer reason/i,
  /do not share/i,
  /informational purposes only/i,
  /internal/i,
];

const KNOWN_SAFE_REASONS = new Set<string>([
  "Your information could not be verified",
  "Cannot validate ID -- upload a clear photo of the full ID",
]);

const KNOWN_SAFE_VARIANTS: Array<{ test: RegExp; value: string }> = [
  { test: /cannot validate id/i, value: "Cannot validate ID -- upload a clear photo of the full ID" },
  { test: /your information could not be verified/i, value: "Your information could not be verified" },
];

export function normalizeBridgeCustomerRejectionReason(input?: string | null): string {
  const provided = String(input || "").trim();
  if (!provided) return BRIDGE_SAFE_REJECTION_DEFAULT;
  if (UNSAFE_PATTERNS.some((p) => p.test(provided))) {
    return BRIDGE_SAFE_REJECTION_DEFAULT;
  }
  if (KNOWN_SAFE_REASONS.has(provided)) return provided;
  for (const variant of KNOWN_SAFE_VARIANTS) {
    if (variant.test.test(provided)) return variant.value;
  }
  // Allow non-empty user-facing strings while guarding against accidental dumps.
  if (provided.length <= 200) return provided;
  return BRIDGE_SAFE_REJECTION_DEFAULT;
}
