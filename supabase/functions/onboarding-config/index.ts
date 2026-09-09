import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  allowedAccountTypes,
  isSignupFlagEnabled,
  resolveTenantOnboardingPolicy,
  sha256Hex,
  verifyOnboardingToken,
} from "../_shared/onboarding-policy.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

function safeBrandLogoUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !host.includes(".") || host === "localhost" || /^[\d.:]+$/.test(host)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeBrandName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= 80 ? name : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const signingSecret = Deno.env.get("ONBOARDING_TOKEN_SIGNING_SECRET") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return json({ success: false, error: "Onboarding configuration is unavailable" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.onboarding_token === "string" ? body.onboarding_token.trim() : "";

  if (!token) {
    const { data } = await admin
      .from("app_config")
      .select("key, value")
      .in("key", ["direct_individual_signup_enabled", "direct_business_signup_enabled"]);
    const values = new Map((data ?? []).map((row: any) => [String(row.key), row.value]));
    const allowed: Array<"individual" | "business"> = [];
    // Both settings fail closed when missing or malformed.
    if (isSignupFlagEnabled(values.get("direct_individual_signup_enabled"))) allowed.push("individual");
    if (isSignupFlagEnabled(values.get("direct_business_signup_enabled"))) allowed.push("business");
    return json({
      success: true,
      data: { channel: "direct", allowed_account_types: allowed },
    });
  }

  try {
    const claims = await verifyOnboardingToken(token, signingSecret);
    const tokenHash = await sha256Hex(token);
    const { data: authorization } = await admin
      .from("api_onboarding_authorizations")
      .select("id, tenant_id, api_key_id, external_user_id, allowed_account_types, onboarding_channel, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!authorization || authorization.used_at || new Date(authorization.expires_at).getTime() <= Date.now() ||
      String(authorization.id) !== claims.jti ||
      String(authorization.tenant_id) !== claims.tenant_id ||
      String(authorization.api_key_id) !== claims.api_key_id ||
      String(authorization.external_user_id) !== claims.external_user_id ||
      String(authorization.onboarding_channel) !== claims.onboarding_channel) {
      throw new Error("This signup link is invalid, expired, or has already been used.");
    }

    const [{ data: tenant }, { data: apiKey }, { data: partnerApproval }] = await Promise.all([
      admin.from("api_tenants").select("id, tenant_name, is_active, metadata").eq("id", claims.tenant_id).maybeSingle(),
      admin.from("api_keys").select("id, tenant_id, is_active, revoked_at").eq("id", claims.api_key_id).maybeSingle(),
      admin.from("api_partner_approvals").select("status,approved_products").eq("tenant_id", claims.tenant_id).maybeSingle(),
    ]);
    const whiteLabelApproved = partnerApproval?.status === "approved" &&
      Array.isArray(partnerApproval.approved_products) &&
      partnerApproval.approved_products.includes("white_label");
    if (!whiteLabelApproved || !tenant?.is_active || !apiKey?.is_active || apiKey.revoked_at || String(apiKey.tenant_id) !== claims.tenant_id) {
      throw new Error("This signup link is no longer active.");
    }

    const policyAllowed = allowedAccountTypes(
      resolveTenantOnboardingPolicy(tenant.metadata),
      claims.onboarding_channel,
    );
    const storedAllowed = Array.isArray(authorization.allowed_account_types)
      ? authorization.allowed_account_types.map(String)
      : [];
    const allowed = claims.allowed_account_types.filter((type) =>
      policyAllowed.includes(type) && storedAllowed.includes(type)
    );
    if (allowed.length === 0) throw new Error("No account type is enabled for this signup link.");

    const whiteLabel = tenant.metadata?.white_label && typeof tenant.metadata.white_label === "object"
      ? tenant.metadata.white_label as Record<string, unknown>
      : {};
    const brandingEnabled = claims.onboarding_channel === "white_label" && whiteLabel.enabled === true;
    const brandName = brandingEnabled
      ? safeBrandName(whiteLabel.app_name) ?? safeBrandName(whiteLabel.brand_name)
      : null;
    const primaryColor = brandingEnabled && typeof whiteLabel.primary_color === "string" &&
        /^#[0-9a-f]{6}$/i.test(whiteLabel.primary_color.trim())
      ? whiteLabel.primary_color.trim().toUpperCase()
      : null;
    return json({
      success: true,
      data: {
        channel: claims.onboarding_channel,
        allowed_account_types: allowed,
        tenant: {
          branding_enabled: Boolean(brandingEnabled && brandName),
          name: brandName ?? tenant.tenant_name,
          logo_url: brandingEnabled ? safeBrandLogoUrl(whiteLabel.logo_url) : null,
          primary_color: primaryColor,
        },
      },
    });
  } catch (error) {
    return json({
      success: false,
      code: "invalid_onboarding_authorization",
      error: "This signup link is invalid, expired, or unavailable.",
    }, 403);
  }
});
