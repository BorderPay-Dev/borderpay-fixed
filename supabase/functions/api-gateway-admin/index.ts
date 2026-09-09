import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  productionPromotionAllowed,
  readApiReleaseGateEnvironment,
} from "../_shared/api-release-gates.ts";
import {
  encryptApiWebhookSecret,
  newApiWebhookSecret,
  validateApiWebhookEndpointUrl,
} from "../_shared/api-webhook-security.ts";
import {
  approvalAllowsProduct,
  approvalAllowsScopes,
  isApprovedPartnerRecord,
  normalizeApprovedPartnerProducts,
  requirePartnerContactEmail,
  requirePartnerApprovalText,
  tenantRequestsPartnerAccess,
} from "../_shared/api-partner-approval.ts";
import {
  normalizeWhiteLabelLogoDataUrl,
  WHITE_LABEL_LOGO_BUCKET,
} from "../_shared/api-white-label-assets.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type Action =
  | "list_tenants"
  | "upsert_tenant"
  | "approve_partner"
  | "suspend_partner"
  | "upload_white_label_logo"
  | "create_api_key"
  | "list_api_keys"
  | "revoke_api_key"
  | "add_ip_allowlist"
  | "list_ip_allowlist"
  | "create_webhook_endpoint"
  | "rotate_webhook_secret"
  | "list_webhook_endpoints"
  | "get_rollout_metrics"
  | "emergency_rollback_tenant";

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${field} is required`);
  }
  return v.trim();
}

function normalizeMode(v: unknown): "sandbox" | "production" {
  const s = String(v ?? "sandbox").trim().toLowerCase();
  if (s !== "sandbox" && s !== "production") {
    throw new Error("default_mode must be sandbox|production");
  }
  return s;
}

function normalizeScopes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

function normalizeTenantMetadata(v: unknown): Record<string, unknown> {
  const metadata = v && typeof v === "object" && !Array.isArray(v)
    ? { ...(v as Record<string, unknown>) }
    : {};
  const raw = metadata.onboarding && typeof metadata.onboarding === "object" && !Array.isArray(metadata.onboarding)
    ? metadata.onboarding as Record<string, unknown>
    : {};
  metadata.onboarding = {
    individual_signup_enabled: raw.individual_signup_enabled === true,
    business_signup_enabled: raw.business_signup_enabled === true,
    white_label_signup_enabled: raw.white_label_signup_enabled === true,
  };
  return metadata;
}

function normalizeWindowMinutes(v: unknown): number {
  const n = Number(v ?? 15);
  if (!Number.isFinite(n)) return 15;
  return Math.max(1, Math.min(1440, Math.floor(n)));
}

async function loadPartnerApproval(supa: any, tenantId: string) {
  const { data, error } = await supa
    .from("api_partner_approvals")
    .select("tenant_id,status,approved_products,approved_at,suspended_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`Partner approval could not be verified: ${error.message}`);
  return data;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function newApiKey(
  mode: "sandbox" | "production",
): { plain: string; prefix: string } {
  const tag = mode === "production" ? "live" : "test";
  const token = crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const plain = `bpk_${tag}_${token}`;
  return { plain, prefix: plain.slice(0, 14) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json({ success: false, error: "POST only" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const API_GATEWAY_ADMIN_TOKEN = Deno.env.get("API_GATEWAY_ADMIN_TOKEN") ?? "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return json({ success: false, error: "Server configuration missing" }, 500);
  }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ success: false, error: "Authorization required" }, 401);
  }

  const isServiceRole = token === SUPABASE_SERVICE_ROLE;
  const isApiGatewayAdmin =
    API_GATEWAY_ADMIN_TOKEN.length > 0 && token === API_GATEWAY_ADMIN_TOKEN;
  let actorId = isApiGatewayAdmin ? "api_gateway_admin_token" : "service_role";
  if (!isServiceRole && !isApiGatewayAdmin) {
    const { data: userInfo, error: authErr } = await supa.auth.getUser(token);
    if (authErr || !userInfo?.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    actorId = userInfo.user.id;

    const { data: admin } = await supa
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userInfo.user.id)
      .maybeSingle();
    if (!admin) return json({ success: false, error: "admin only" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const action = String(body?.action || "") as Action;
  if (!action) return json({ success: false, error: "action required" }, 400);

  try {
    if (action === "list_tenants") {
      const [tenantsResult, approvalsResult] = await Promise.all([
        supa.from("api_tenants")
          .select(
            "id, business_user_id, tenant_name, default_mode, is_active, beta_access_enabled, max_single_transfer_usd, rate_limit_per_minute, metadata, created_at, updated_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supa.from("api_partner_approvals")
          .select(
            "tenant_id,status,partner_type,approved_products,approved_use_case,technical_contact_email,compliance_contact_email,incident_contact_email,compliance_approval_reference,engineering_approval_reference,compliance_approved_by,engineering_approved_by,recorded_by,approved_at,suspended_at,suspended_by,suspension_reason",
          ),
      ]);
      if (tenantsResult.error) throw new Error(tenantsResult.error.message);
      if (approvalsResult.error) {
        throw new Error(`Partner approvals could not be loaded: ${approvalsResult.error.message}`);
      }
      const approvals = new Map(
        (approvalsResult.data ?? []).map((row: any) => [String(row.tenant_id), row]),
      );
      const data = (tenantsResult.data ?? []).map((tenant: any) => ({
        ...tenant,
        partner_approval: approvals.get(String(tenant.id)) ?? null,
      }));
      return json({ success: true, data });
    }

    if (action === "upsert_tenant") {
      const tenantId = String(body?.tenant_id || "").trim();
      const requestedMode = normalizeMode(body?.default_mode);
      const requestedBetaAccess = body?.beta_access_enabled === true;
      if (
        (requestedMode === "production" || requestedBetaAccess) &&
        !productionPromotionAllowed(readApiReleaseGateEnvironment())
      ) {
        return json({
          success: false,
          error: "Production API promotion is globally locked",
          code: "production_promotion_locked",
        }, 403);
      }
      const normalizedMetadata = normalizeTenantMetadata(body?.metadata);
      const requestedAccess = tenantRequestsPartnerAccess(normalizedMetadata);
      if (
        !tenantId &&
        (requestedMode !== "sandbox" || requestedBetaAccess || body?.is_active === true)
      ) {
        return json({
          success: false,
          error: "New partner tenants must be created disabled and sandbox-only",
          code: "tenant_quarantine_required",
        }, 403);
      }
      if ((requestedAccess.onboarding || requestedAccess.whiteLabel) && !tenantId) {
        return json({
          success: false,
          error: "Create the tenant without partner access, then record partner approval",
          code: "partner_approval_required",
        }, 403);
      }
      if (tenantId && (requestedAccess.onboarding || requestedAccess.whiteLabel)) {
        const approval = await loadPartnerApproval(supa, tenantId);
        const onboardingAllowed = approvalAllowsProduct(approval, "api") ||
          approvalAllowsProduct(approval, "white_label");
        const allowed = (!requestedAccess.onboarding || onboardingAllowed) &&
          (!requestedAccess.whiteLabel || approvalAllowsProduct(approval, "white_label"));
        if (!allowed) {
          return json({
            success: false,
            error: "Approved partner products do not permit the requested tenant access",
            code: "partner_approval_required",
          }, 403);
        }
      }
      const payload = {
        business_user_id: body?.business_user_id
          ? String(body.business_user_id)
          : null,
        tenant_name: requireString(body?.tenant_name, "tenant_name"),
        default_mode: requestedMode,
        is_active: tenantId ? body?.is_active !== false : false,
        beta_access_enabled: body?.beta_access_enabled === true,
        max_single_transfer_usd: body?.max_single_transfer_usd == null
          ? null
          : Math.max(1, Number(body.max_single_transfer_usd)),
        rate_limit_per_minute: Math.max(
          1,
          Math.min(5000, Number(body?.rate_limit_per_minute || 120)),
        ),
        metadata: normalizedMetadata,
      };

      if (tenantId) {
        const { data, error } = await supa
          .from("api_tenants")
          .update(payload)
          .eq("id", tenantId)
          .select(
            "id, tenant_name, default_mode, is_active, beta_access_enabled, max_single_transfer_usd, rate_limit_per_minute, metadata, updated_at",
          )
          .single();
        if (error) throw new Error(error.message);
        return json({ success: true, data, mode: "updated" });
      }

      const { data, error } = await supa
        .from("api_tenants")
        .insert(payload)
        .select(
          "id, tenant_name, default_mode, is_active, beta_access_enabled, max_single_transfer_usd, rate_limit_per_minute, metadata, created_at",
        )
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data, mode: "created" }, 201);
    }

    if (action === "approve_partner") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const { data: tenant, error: tenantError } = await supa
        .from("api_tenants")
        .select("id,default_mode,is_active,beta_access_enabled,metadata")
        .eq("id", tenantId)
        .maybeSingle();
      if (tenantError) throw new Error(tenantError.message);
      if (!tenant) return json({ success: false, error: "tenant not found" }, 404);
      const storedPartnerAccess = tenantRequestsPartnerAccess(
        normalizeTenantMetadata(tenant.metadata),
      );
      if (
        tenant.default_mode !== "sandbox" ||
        tenant.is_active === true ||
        tenant.beta_access_enabled === true ||
        storedPartnerAccess.onboarding ||
        storedPartnerAccess.whiteLabel
      ) {
        return json({
          success: false,
          error: "Partner approval requires a disabled, sandbox-only tenant with all onboarding and branding flags off",
          code: "tenant_quarantine_required",
        }, 403);
      }
      const { count: activeKeyCount, error: activeKeyError } = await supa
        .from("api_keys")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("revoked_at", null);
      if (activeKeyError) throw new Error(activeKeyError.message);
      if ((activeKeyCount ?? 0) > 0) {
        return json({
          success: false,
          error: "Partner approval requires all pre-approval API keys to be revoked",
          code: "tenant_quarantine_required",
        }, 403);
      }
      const now = new Date().toISOString();
      const approval = {
        tenant_id: tenantId,
        status: "approved",
        partner_type: requirePartnerApprovalText(body?.partner_type, "partner_type", 80),
        approved_products: normalizeApprovedPartnerProducts(body?.approved_products),
        approved_use_case: requirePartnerApprovalText(body?.approved_use_case, "approved_use_case", 1000),
        technical_contact_email: requirePartnerContactEmail(
          body?.technical_contact_email,
          "technical_contact_email",
        ),
        compliance_contact_email: requirePartnerContactEmail(
          body?.compliance_contact_email,
          "compliance_contact_email",
        ),
        incident_contact_email: requirePartnerContactEmail(
          body?.incident_contact_email,
          "incident_contact_email",
        ),
        compliance_approval_reference: requirePartnerApprovalText(
          body?.compliance_approval_reference,
          "compliance_approval_reference",
          300,
        ),
        engineering_approval_reference: requirePartnerApprovalText(
          body?.engineering_approval_reference,
          "engineering_approval_reference",
          300,
        ),
        compliance_approved_by: requirePartnerApprovalText(
          body?.compliance_approved_by,
          "compliance_approved_by",
          200,
        ),
        engineering_approved_by: requirePartnerApprovalText(
          body?.engineering_approved_by,
          "engineering_approved_by",
          200,
        ),
        recorded_by: actorId,
        approved_at: now,
        suspended_at: null,
        suspended_by: null,
        suspension_reason: null,
      };
      const { data, error } = await supa
        .from("api_partner_approvals")
        .upsert(approval, { onConflict: "tenant_id" })
        .select("tenant_id,status,partner_type,approved_products,approved_use_case,technical_contact_email,compliance_contact_email,incident_contact_email,approved_at,recorded_by")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "suspend_partner") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const reason = requirePartnerApprovalText(body?.reason, "reason", 500);
      const now = new Date().toISOString();
      // Approval is suspended first. The database resolver immediately rejects
      // every key even if a later defence-in-depth revocation operation fails.
      const { data, error } = await supa
        .from("api_partner_approvals")
        .update({
          status: "suspended",
          suspended_at: now,
          suspended_by: actorId,
          suspension_reason: reason,
        })
        .eq("tenant_id", tenantId)
        .select("tenant_id,status,suspended_at,suspended_by")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return json({ success: false, error: "partner approval not found" }, 404);
      const { error: revokeError } = await supa
        .from("api_keys")
        .update({ is_active: false, revoked_at: now })
        .eq("tenant_id", tenantId)
        .eq("is_active", true);
      if (revokeError) throw new Error(`Partner suspended; key revocation requires follow-up: ${revokeError.message}`);
      return json({ success: true, data });
    }

    if (action === "upload_white_label_logo") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const { data: tenant, error: tenantError } = await supa
        .from("api_tenants")
        .select("id")
        .eq("id", tenantId)
        .maybeSingle();
      if (tenantError) throw new Error(tenantError.message);
      if (!tenant) return json({ success: false, error: "tenant not found" }, 404);
      const approval = await loadPartnerApproval(supa, tenantId);
      if (!approvalAllowsProduct(approval, "white_label")) {
        return json({
          success: false,
          error: "White-label partner approval is required before uploading branding",
          code: "partner_approval_required",
        }, 403);
      }

      const logo = normalizeWhiteLabelLogoDataUrl(body?.file_data_url);
      const filePath = `${tenantId}/logo.${logo.ext}`;
      const { error: uploadError } = await supa.storage
        .from(WHITE_LABEL_LOGO_BUCKET)
        .upload(filePath, logo.bytes, {
          contentType: logo.contentType,
          upsert: true,
          cacheControl: "3600",
        });
      if (uploadError) throw new Error(uploadError.message);
      const { data: publicUrl } = supa.storage
        .from(WHITE_LABEL_LOGO_BUCKET)
        .getPublicUrl(filePath);
      return json({
        success: true,
        data: {
          tenant_id: tenantId,
          logo_url: publicUrl.publicUrl,
          content_type: logo.contentType,
          size_bytes: logo.bytes.byteLength,
        },
      });
    }

    if (action === "create_api_key") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const { data: tenant, error: tErr } = await supa
        .from("api_tenants")
        .select("id, default_mode")
        .eq("id", tenantId)
        .maybeSingle();
      if (tErr) throw new Error(tErr.message);
      if (!tenant) {
        return json({ success: false, error: "tenant not found" }, 404);
      }
      const approval = await loadPartnerApproval(supa, tenantId);
      if (!isApprovedPartnerRecord(approval)) {
        return json({
          success: false,
          error: "Partner approval is required before issuing credentials",
          code: "partner_approval_required",
        }, 403);
      }

      const mode = normalizeMode(tenant.default_mode);
      const scopes = normalizeScopes(body?.scopes);
      if (!approvalAllowsScopes(approval, scopes)) {
        return json({
          success: false,
          error: "Approved partner products do not permit the requested API scopes",
          code: "partner_product_forbidden",
        }, 403);
      }
      const key = newApiKey(mode);
      const keyHash = await sha256Hex(key.plain);

      const { data, error } = await supa
        .from("api_keys")
        .insert({
          tenant_id: tenantId,
          key_prefix: key.prefix,
          key_hash: keyHash,
          key_label: String(body?.key_label || "").trim() || null,
          scopes,
          created_by: isServiceRole ? null : actorId,
        })
        .select(
          "id, tenant_id, key_prefix, key_label, scopes, is_active, created_at",
        )
        .single();
      if (error) throw new Error(error.message);

      return json({
        success: true,
        data: {
          ...data,
          plain_api_key: key.plain,
        },
      }, 201);
    }

    if (action === "list_api_keys") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const { data, error } = await supa
        .from("api_keys")
        .select(
          "id, tenant_id, key_prefix, key_label, scopes, is_active, revoked_at, last_used_at, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "revoke_api_key") {
      const keyId = requireString(body?.key_id, "key_id");
      const { data, error } = await supa
        .from("api_keys")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("id", keyId)
        .select("id, tenant_id, key_prefix, is_active, revoked_at")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "add_ip_allowlist") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const cidrBlock = requireString(body?.cidr_block, "cidr_block");
      const { data, error } = await supa
        .from("api_ip_allowlist")
        .insert({
          tenant_id: tenantId,
          cidr_block: cidrBlock,
          note: String(body?.note || "").trim() || null,
        })
        .select("id, tenant_id, cidr_block, note, is_active, created_at")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data }, 201);
    }

    if (action === "list_ip_allowlist") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const { data, error } = await supa
        .from("api_ip_allowlist")
        .select("id, tenant_id, cidr_block, note, is_active, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "create_webhook_endpoint") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const endpointUrl = validateApiWebhookEndpointUrl(
        requireString(body?.endpoint_url, "endpoint_url"),
      );
      const webhookId = crypto.randomUUID();
      const secretVersion = 1;
      const secret = newApiWebhookSecret();
      const secretHash = await sha256Hex(secret);
      const encrypted = await encryptApiWebhookSecret(secret, webhookId, secretVersion);

      const { data, error } = await supa
        .from("api_webhook_endpoints")
        .insert({
          id: webhookId,
          tenant_id: tenantId,
          endpoint_url: endpointUrl,
          signing_secret_hash: secretHash,
          signing_secret_ciphertext: encrypted.ciphertext,
          signing_secret_nonce: encrypted.nonce,
          signing_secret_version: secretVersion,
          delivery_enabled: true,
        })
        .select("id, tenant_id, endpoint_url, is_active, created_at")
        .single();
      if (error) throw new Error(error.message);

      return json(
        { success: true, data: { ...data, signing_secret: secret } },
        201,
      );
    }

    if (action === "rotate_webhook_secret") {
      const webhookId = requireString(body?.webhook_id, "webhook_id");
      const { data: current, error: currentError } = await supa
        .from("api_webhook_endpoints")
        .select("id,endpoint_url,signing_secret_version")
        .eq("id", webhookId)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current?.id) throw new Error("Webhook endpoint not found");
      validateApiWebhookEndpointUrl(String(current.endpoint_url));
      const secretVersion = Number(current.signing_secret_version ?? 0) + 1;
      const secret = newApiWebhookSecret();
      const secretHash = await sha256Hex(secret);
      const encrypted = await encryptApiWebhookSecret(secret, webhookId, secretVersion);

      const { data, error } = await supa
        .from("api_webhook_endpoints")
        .update({
          signing_secret_hash: secretHash,
          signing_secret_ciphertext: encrypted.ciphertext,
          signing_secret_nonce: encrypted.nonce,
          signing_secret_version: secretVersion,
          delivery_enabled: true,
        })
        .eq("id", webhookId)
        .select("id, tenant_id, endpoint_url, is_active, updated_at")
        .single();
      if (error) throw new Error(error.message);

      return json({ success: true, data: { ...data, signing_secret: secret } });
    }

    if (action === "list_webhook_endpoints") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const { data, error } = await supa
        .from("api_webhook_endpoints")
        .select(
          "id, tenant_id, endpoint_url, is_active, delivery_enabled, event_types, created_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "get_rollout_metrics") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const windowMinutes = normalizeWindowMinutes(body?.window_minutes);
      const { data, error } = await supa.rpc("api_gateway_rollout_metrics", {
        p_tenant_id: tenantId,
        p_window_minutes: windowMinutes,
      });
      if (error) throw new Error(error.message);
      return json({ success: true, data: Array.isArray(data) ? data[0] : null });
    }

    if (action === "emergency_rollback_tenant") {
      const tenantId = requireString(body?.tenant_id, "tenant_id");
      const revokeActiveKeys = body?.revoke_active_keys !== false;
      const { data, error } = await supa.rpc("api_gateway_emergency_rollback", {
        p_tenant_id: tenantId,
        p_revoke_active_keys: revokeActiveKeys,
      });
      if (error) throw new Error(error.message);
      return json({ success: true, data: Array.isArray(data) ? data[0] : null });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return json({ success: false, error: msg }, 500);
  }
});
