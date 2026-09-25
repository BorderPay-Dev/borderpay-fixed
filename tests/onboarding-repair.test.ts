import { exactServiceCredential, restrictionReason, providerLinkReason } from "../supabase/functions/bridge-missing-customer-migration/policy.ts";
const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${a} != ${b}`); };
const profile = { id: "synthetic", email: "owner@example.invalid", account_type: "business", account_status: "pending_kyc", payment_provider: "bridge" };
const auth = { email: profile.email, email_confirmed_at: "2026-09-25" };
Deno.test("operator credential rejects forged service-role JWTs and missing secrets", () => {
  const forged = `e30.${btoa(JSON.stringify({ role: "service_role" }))}.fake`;
  eq(exactServiceCredential(forged, "real-secret"), false);
  eq(exactServiceCredential("", ""), false);
  eq(exactServiceCredential("real-secrex", "real-secret"), false);
  eq(exactServiceCredential("real-secret", "real-secret"), true);
});
Deno.test("repair preserves local and provider restrictions", () => {
  for (const field of ["account_status", "bridge_account_status", "bridge_kyc_status"]) {
    for (const state of ["paused", "frozen", "rejected", "offboarded", "fraud", "disabled", "suspended"]) eq(restrictionReason({ ...profile, [field]: state }, null, auth), "account_restricted");
  }
  eq(restrictionReason(profile, { bridge_kyb_status: "rejected" }, auth), "account_restricted");
  eq(restrictionReason({ ...profile, account_frozen_reason: "fraud recall" }, null, auth), "account_restricted");
  eq(restrictionReason(profile, null, { ...auth, banned_until: "2099-01-01" }), "auth_account_restricted");
});
Deno.test("repair rejects operator, demo, unrelated-provider, and changed-email profiles", () => {
  eq(restrictionReason({ ...profile, is_demo: true }, null, auth), "operator_or_demo_account");
  eq(restrictionReason({ ...profile, payment_provider: "other" }, null, auth), "different_provider");
  eq(restrictionReason(profile, null, { email: "other@example.invalid" }), "auth_email_mismatch");
  eq(restrictionReason(profile, null, auth), null);
});
Deno.test("existing provider IDs require exact identity match and unrestricted status", () => {
  const raw = { email: profile.email, type: "business", business_name: "Synthetic Ltd", status: "not_started", metadata: { borderpay_user_id: profile.id } };
  const business = { company_name: "Synthetic Ltd" };
  eq(providerLinkReason(raw, profile, business), null);
  eq(providerLinkReason({ ...raw, status: "paused" }, profile, business), "provider_customer_restricted");
  eq(providerLinkReason({ ...raw, email: "someone@example.invalid" }, profile, business), "provider_email_mismatch");
  eq(providerLinkReason({ ...raw, business_name: "Other Ltd" }, profile, business), "provider_company_name_mismatch");
  eq(providerLinkReason({ ...raw, metadata: { borderpay_user_id: "other" } }, profile, business), "provider_customer_owned_by_another_user");
});
