import {
  allowedAccountTypes,
  resolveTenantOnboardingPolicy,
  sha256Hex,
  signOnboardingToken,
} from "./onboarding-policy.ts";
import { loadPublishedWhiteLabel } from "./white-label-config.ts";
/** Call only after the existing CAPTCHA and signup abuse checks have passed. */
export async function prepareWhiteLabelSignup(
  db: any,
  origin: string,
  body: any,
  secret: string,
) {
  const release = await loadPublishedWhiteLabel(db, { origin });
  if (!release) {
    throw new Error("This customer app is not available for signup.");
  }
  if (
    release.status === "pilot" &&
    !release.pilot_emails?.includes(
      String(body.email || "").trim().toLowerCase(),
    )
  ) throw new Error("This customer app is accepting invited pilot users only.");
  if (
    body.white_label_legal_version !== release.brand.legal_version ||
    body.white_label_revision !== release.revision ||
    body.accept_partner_terms !== true
  ) {
    throw new Error(
      "Review the current Terms and Privacy Policy before creating an account.",
    );
  }
  const allowed = allowedAccountTypes(
    resolveTenantOnboardingPolicy(release.metadata),
    "white_label",
  );
  if (!allowed.includes(body.account_type)) {
    throw new Error(
      "This account type is not available for this customer app.",
    );
  }
  const { data: key, error } = await db.from("api_keys").select("id").eq(
    "id",
    release.managed_key_id,
  ).eq("tenant_id", release.tenant_id).eq("is_active", true).is(
    "revoked_at",
    null,
  ).maybeSingle();
  if (error || !key) throw new Error("Customer signup is not enabled yet.");
  const now = Math.floor(Date.now() / 1000),
    id = crypto.randomUUID(),
    externalId = crypto.randomUUID();
  const token = await signOnboardingToken({
    iss: "borderpay",
    aud: "partner_onboarding",
    jti: id,
    tenant_id: release.tenant_id,
    api_key_id: key.id,
    external_user_id: externalId,
    allowed_account_types: allowed,
    onboarding_channel: "white_label",
    iat: now,
    exp: now + 300,
  }, secret);
  const { error: insertError } = await db.from("api_onboarding_authorizations")
    .insert({
      id,
      tenant_id: release.tenant_id,
      api_key_id: key.id,
      token_hash: await sha256Hex(token),
      external_user_id: externalId,
      allowed_account_types: allowed,
      onboarding_channel: "white_label",
      expires_at: new Date((now + 300) * 1000).toISOString(),
    });
  if (insertError) throw new Error("Unable to authorize signup.");
  const { error: legalError } = await db.from("white_label_legal_acceptances")
    .insert({
      authorization_id: id,
      tenant_id: release.tenant_id,
      release_revision: release.revision,
      legal_version: release.brand.legal_version,
      terms_url: release.brand.terms_url,
      privacy_url: release.brand.privacy_url,
      app_origin: release.brand.app_origin,
    });
  if (legalError) {
    await db.from("api_onboarding_authorizations").delete().eq("id", id);
    throw new Error("Unable to record legal acceptance.");
  }
  return { token, release };
}
