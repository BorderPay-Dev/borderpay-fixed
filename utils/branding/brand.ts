import type { WhiteLabelBrand } from "../../supabase/functions/_shared/white-label-config";
export type CustomerBrand = {
  brand: WhiteLabelBrand;
  revision: number;
  allowed_account_types: ("business" | "individual")[];
};
let current: CustomerBrand | null = null;
export const getCustomerBrand = () => current;
export const setCustomerBrand = (value: CustomerBrand | null) => {
  current = value;
};
export const brandName = () => current?.brand.brand_name || "BorderPay Africa";
export const supportEmail = () =>
  current?.brand.support_email || "support@borderpayafrica.com";
export function openBrandLink(kind: "terms" | "privacy" | "support"): boolean {
  const url = current
    ?.brand[`${kind}_url` as "terms_url" | "privacy_url" | "support_url"];
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
export function captureOnboardingToken() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("onboarding_token");
  if (!token) return;
  sessionStorage.setItem("bp_onboarding_token", token);
  fragment.delete("onboarding_token");
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}${
      fragment.size ? "#" + fragment.toString() : ""
    }`,
  );
}
export function signupBrandContext() {
  const token = sessionStorage.getItem("bp_onboarding_token");
  if (token) {
    return {
      onboarding_token: token,
      ...(current
        ? {
          white_label_legal_version: current.brand.legal_version,
          white_label_revision: current.revision,
          accept_partner_terms: true,
        }
        : {}),
    };
  }
  return current
    ? {
      white_label_signup: true,
      white_label_legal_version: current.brand.legal_version,
      white_label_revision: current.revision,
      accept_partner_terms: true,
    }
    : {};
}
