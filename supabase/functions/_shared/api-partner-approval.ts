export const API_PARTNER_PRODUCTS = ["api", "white_label"] as const;
export type ApiPartnerProduct = typeof API_PARTNER_PRODUCTS[number];

const allowedProducts = new Set<string>(API_PARTNER_PRODUCTS);

export function normalizeApprovedPartnerProducts(value: unknown): ApiPartnerProduct[] {
  if (!Array.isArray(value)) throw new Error("approved_products must be an array");
  const products = [...new Set(value.map((item) => String(item ?? "").trim()))]
    .filter(Boolean);
  if (products.length === 0 || products.some((product) => !allowedProducts.has(product))) {
    throw new Error("approved_products must contain api and/or white_label");
  }
  return products as ApiPartnerProduct[];
}

export function requirePartnerApprovalText(
  value: unknown,
  field: string,
  max = 500,
): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} is too long`);
  return text;
}

export function requirePartnerContactEmail(value: unknown, field: string): string {
  const email = requirePartnerApprovalText(value, field, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${field} must be a valid email address`);
  }
  return email;
}

export function isApprovedPartnerRecord(value: unknown): value is {
  status: "approved";
  approved_products: ApiPartnerProduct[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.status !== "approved" || !Array.isArray(row.approved_products)) return false;
  try {
    return normalizeApprovedPartnerProducts(row.approved_products).length > 0;
  } catch {
    return false;
  }
}

export function approvalAllowsProduct(
  approval: unknown,
  product: ApiPartnerProduct,
): boolean {
  return isApprovedPartnerRecord(approval) && approval.approved_products.includes(product);
}

export function approvalAllowsScopes(approval: unknown, scopes: string[]): boolean {
  if (!isApprovedPartnerRecord(approval)) return false;
  if (approval.approved_products.includes("api")) return true;
  return approval.approved_products.includes("white_label") &&
    scopes.length > 0 && scopes.every((scope) => scope === "onboarding:write");
}

export function tenantRequestsPartnerAccess(metadata: unknown): {
  onboarding: boolean;
  whiteLabel: boolean;
} {
  const root = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
  const onboarding = root.onboarding && typeof root.onboarding === "object" && !Array.isArray(root.onboarding)
    ? root.onboarding as Record<string, unknown>
    : {};
  const whiteLabel = root.white_label && typeof root.white_label === "object" && !Array.isArray(root.white_label)
    ? root.white_label as Record<string, unknown>
    : {};
  return {
    onboarding: onboarding.individual_signup_enabled === true ||
      onboarding.business_signup_enabled === true,
    whiteLabel: onboarding.white_label_signup_enabled === true ||
      whiteLabel.enabled === true,
  };
}
