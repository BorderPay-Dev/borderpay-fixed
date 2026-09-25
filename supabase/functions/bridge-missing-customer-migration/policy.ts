// Shared, side-effect-free eligibility checks for operator onboarding repair.
const restricted = new Set([
  "paused",
  "frozen",
  "rejected",
  "suspended",
  "disabled",
  "closed",
  "offboarded",
  "fraud",
  "deactivated",
]);
export function exactServiceCredential(
  token: string,
  expected: string,
): boolean {
  if (!token || !expected) return false;
  const a = new TextEncoder().encode(token),
    b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export function restrictionReason(
  profile: any,
  business: any,
  auth: any,
): string | null {
  if (
    profile.is_admin || profile.is_demo ||
    /@borderpayafrica\.com$/i.test(profile.email || "")
  ) return "operator_or_demo_account";
  if (
    auth.deleted_at ||
    (auth.banned_until && Date.parse(auth.banned_until) > Date.now())
  ) return "auth_account_restricted";
  if (
    String(auth.email || "").toLowerCase() !==
      String(profile.email || "").toLowerCase()
  ) return "auth_email_mismatch";
  if (profile.account_frozen_at || profile.account_frozen_reason) {
    return "account_restricted";
  }
  if (
    [
      profile.account_status,
      profile.bridge_account_status,
      profile.bridge_kyc_status,
      business?.status,
      business?.bridge_kyb_status,
    ]
      .some((v) => restricted.has(String(v || "").trim().toLowerCase()))
  ) return "account_restricted";
  if (profile.payment_provider && profile.payment_provider !== "bridge") {
    return "different_provider";
  }
  if (!["business", "individual"].includes(profile.account_type)) {
    return "unsupported_account_type";
  }
  return null;
}
export function providerLinkReason(
  raw: any,
  profile: any,
  business: any,
): string | null {
  if (
    String(raw.email || raw.business_email || "").trim().toLowerCase() !==
      String(profile.email).trim().toLowerCase()
  ) return "provider_email_mismatch";
  if (raw.type !== profile.account_type) {
    return "provider_account_type_mismatch";
  }
  if (restricted.has(String(raw.status || "").toLowerCase())) {
    return "provider_customer_restricted";
  }
  if (
    raw.metadata?.borderpay_user_id &&
    raw.metadata.borderpay_user_id !== profile.id
  ) return "provider_customer_owned_by_another_user";
  if (
    profile.account_type === "business" &&
    String(raw.business_name || raw.name || "").trim().toLowerCase() !==
      String(business?.company_name || "").trim().toLowerCase()
  ) return "provider_company_name_mismatch";
  return null;
}
