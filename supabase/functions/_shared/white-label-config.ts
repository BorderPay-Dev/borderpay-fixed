/** Public branding is published by an operator, never by a browser tenant ID. */
export type WhiteLabelBrand = {
  brand_name: string;
  legal_name: string;
  logo_url: string;
  primary_color: string;
  app_origin: string;
  support_email: string;
  support_url: string;
  privacy_url: string;
  terms_url: string;
  legal_version: string;
  email_sender_name?: string;
  email_reply_to?: string;
};
export function httpsUrl(value: unknown, originOnly = false): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("A valid HTTPS URL is required");
  }
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    !url.hostname.includes(".") ||
    /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname) ||
    url.hostname.endsWith(".local")
  ) {
    throw new Error("A public HTTPS URL is required");
  }
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("App URL must contain only the HTTPS domain");
  }
  return originOnly ? url.origin : url.href;
}
export function validateWhiteLabelBrand(input: unknown): WhiteLabelBrand {
  const b = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const label = (key: string, max = 120) => {
    const text = typeof b[key] === "string" ? b[key].trim() : "";
    if (!text || text.length > max || /[<>\x00-\x1f\x7f]/.test(text)) {
      throw new Error(`${key} is required and must be plain text`);
    }
    return text;
  };
  const primary_color = label("primary_color", 7).toUpperCase();
  if (!/^#[A-F0-9]{6}$/.test(primary_color)) {
    throw new Error("Primary color must be a six-digit hex color");
  }
  // Existing app places black text on accent buttons. Preserve readable contrast.
  const rgb = [1, 3, 5].map((i) =>
    parseInt(primary_color.slice(i, i + 2), 16) / 255
  ).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  if ((.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] + .05) / .05 < 4.5) {
    throw new Error(
      "Choose a lighter primary color for readable black button text",
    );
  }
  const support_email = label("support_email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(support_email)) {
    throw new Error("Valid support email required");
  }
  const email_reply_to =
    typeof b.email_reply_to === "string" && b.email_reply_to.trim()
      ? label("email_reply_to", 254).toLowerCase()
      : support_email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_reply_to)) {
    throw new Error("Valid reply-to email required");
  }
  return {
    email_sender_name: b.email_sender_name
      ? label("email_sender_name")
      : label("brand_name"),
    email_reply_to,
    brand_name: label("brand_name"),
    legal_name: label("legal_name", 200),
    primary_color,
    logo_url: httpsUrl(b.logo_url),
    app_origin: httpsUrl(b.app_origin, true),
    support_email,
    support_url: httpsUrl(b.support_url),
    privacy_url: httpsUrl(b.privacy_url),
    terms_url: httpsUrl(b.terms_url),
    legal_version: label("legal_version", 80),
  };
}
export async function loadPublishedWhiteLabel(
  db: any,
  selector: { origin: string } | { tenantId: string },
) {
  let query = db.from("white_label_releases").select(
    "tenant_id,published,revision,managed_key_id,status,domain_verified_at,pilot_emails",
  ).in("status", ["live", "pilot"]);
  query = "origin" in selector
    ? query.eq("app_origin", selector.origin)
    : query.eq("tenant_id", selector.tenantId);
  const { data: release, error } = await query.maybeSingle();
  if (error) throw new Error("White-label configuration unavailable");
  if (!release || !release.domain_verified_at) return null;
  const [{ data: tenant, error: te }, { data: approval, error: ae }] =
    await Promise.all([
      db.from("api_tenants").select("id,is_active,default_mode,metadata").eq(
        "id",
        release.tenant_id,
      ).maybeSingle(),
      db.from("api_partner_approvals").select("status,approved_products").eq(
        "tenant_id",
        release.tenant_id,
      ).maybeSingle(),
    ]);
  if (te || ae) throw new Error("White-label approval unavailable");
  if (
    !tenant?.is_active || tenant.default_mode !== "production" || tenant.metadata?.production_access !== true || approval?.status !== "approved" ||
    !approval.approved_products?.includes("white_label")
  ) return null;
  const brand = validateWhiteLabelBrand(release.published);
  if ("origin" in selector && brand.app_origin !== selector.origin) {
    throw new Error("White-label domain mismatch");
  }
  return { ...release, brand, metadata: tenant.metadata };
}
export async function customerAppOrigin(
  db: any,
  userId: string,
  fallback: string,
): Promise<string> {
  const { data: owner, error } = await db.from("account_origin_provenance")
    .select("tenant_id,onboarding_channel").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Customer app ownership unavailable");
  if (owner?.onboarding_channel !== "white_label") return fallback;
  const release = await loadPublishedWhiteLabel(db, {
    tenantId: owner.tenant_id,
  });
  if (!release) throw new Error("Customer app is not available");
  return release.brand.app_origin;
}
