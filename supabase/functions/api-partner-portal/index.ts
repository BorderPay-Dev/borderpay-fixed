import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  newPartnerApiKey,
  normalizePartnerApiKeyScopes,
  normalizePartnerKeyLabel,
  partnerSha256Hex,
  requireOwnedResourceId,
} from "../_shared/api-partner-portal.ts";
import {
  encryptApiWebhookSecret,
  newApiWebhookSecret,
  sha256Hex,
  validateApiWebhookEndpointUrl,
} from "../_shared/api-webhook-security.ts";
import {
  approvalAllowsScopes,
  isApprovedPartnerRecord,
} from "../_shared/api-partner-approval.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

type Action =
  | "get_portal"
  | "create_api_key"
  | "revoke_api_key"
  | "add_ip_allowlist"
  | "disable_ip_allowlist"
  | "create_webhook_endpoint"
  | "rotate_webhook_secret"
  | "disable_webhook_endpoint";

function requiredString(value: unknown, field: string, max = 500): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${field} is required`);
  if (result.length > max) throw new Error(`${field} is too long`);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRole) return json({ success: false, error: "Server configuration missing" }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === serviceRole) return json({ success: false, error: "User authorization required" }, 401);

  const supa = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await supa.auth.getUser(token);
  if (authError || !authData.user) return json({ success: false, error: "Unauthorized" }, 401);
  const userId = authData.user.id;

  const { data: profile, error: profileError } = await supa
    .from("user_profiles")
    .select("id,account_type")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return json({ success: false, error: "Account eligibility could not be verified" }, 503);
  if (String(profile?.account_type ?? "").toLowerCase() !== "business") {
    return json({ success: false, error: "Business account required" }, 403);
  }

  // Tenant identity is always derived from the authenticated user. A browser-
  // supplied tenant_id is intentionally ignored and never used in a query.
  const { data: tenant, error: tenantError } = await supa
    .from("api_tenants")
    .select("id,tenant_name,default_mode,is_active,beta_access_enabled,rate_limit_per_minute,metadata,created_at,updated_at")
    .eq("business_user_id", userId)
    .maybeSingle();
  if (tenantError) return json({ success: false, error: "API access could not be verified" }, 503);
  if (!tenant) return json({ success: false, error: "API access has not been approved for this business", code: "not_approved" }, 403);

  const { data: approval, error: approvalError } = await supa
    .from("api_partner_approvals")
    .select("status,approved_products,approved_at")
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (approvalError) {
    return json({ success: false, error: "Partner approval could not be verified" }, 503);
  }
  if (!isApprovedPartnerRecord(approval)) {
    return json({
      success: false,
      error: "API and white-label access has not been approved for this business",
      code: "not_approved",
    }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "") as Action;

  try {
    if (action === "get_portal") {
      const [keysResult, ipResult, webhookResult, logResult] = await Promise.all([
        supa.from("api_keys")
          .select("id,key_prefix,key_label,scopes,is_active,revoked_at,last_used_at,created_at")
          .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
        supa.from("api_ip_allowlist")
          .select("id,cidr_block,note,is_active,created_at")
          .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
        supa.from("api_webhook_endpoints")
          .select("id,endpoint_url,is_active,delivery_enabled,event_types,created_at,updated_at")
          .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
        supa.from("api_request_log")
          .select("status_code,error_code,latency_ms,created_at")
          .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(50),
      ]);
      if (keysResult.error || ipResult.error || webhookResult.error || logResult.error) {
        return json({ success: false, error: "Partner portal data could not be loaded" }, 503);
      }
      return json({ success: true, data: {
        tenant,
        api_keys: keysResult.data ?? [],
        ip_allowlist: ipResult.data ?? [],
        webhook_endpoints: webhookResult.data ?? [],
        recent_requests: logResult.data ?? [],
      } });
    }

    if (action === "create_api_key") {
      if (!tenant.is_active) return json({ success: false, error: "API access is inactive" }, 403);
      const scopes = normalizePartnerApiKeyScopes(body.scopes);
      if (!approvalAllowsScopes(approval, scopes)) {
        return json({
          success: false,
          error: "Approved partner products do not permit the requested API scopes",
          code: "partner_product_forbidden",
        }, 403);
      }
      const key = newPartnerApiKey(tenant.default_mode === "production" ? "production" : "sandbox");
      const { data, error } = await supa.from("api_keys").insert({
        tenant_id: tenant.id,
        key_prefix: key.prefix,
        key_hash: await partnerSha256Hex(key.plain),
        key_label: normalizePartnerKeyLabel(body.key_label),
        scopes,
        created_by: userId,
      }).select("id,key_prefix,key_label,scopes,is_active,created_at").single();
      if (error) throw new Error("API key could not be created");
      return json({ success: true, data: { ...data, plain_api_key: key.plain } }, 201);
    }

    if (action === "revoke_api_key") {
      const keyId = requireOwnedResourceId(body.key_id, "key_id");
      const { data, error } = await supa.from("api_keys")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("id", keyId).eq("tenant_id", tenant.id)
        .select("id,key_prefix,is_active,revoked_at").maybeSingle();
      if (error) throw new Error("API key could not be revoked");
      if (!data) return json({ success: false, error: "API key not found" }, 404);
      return json({ success: true, data });
    }

    if (action === "add_ip_allowlist") {
      const { data, error } = await supa.from("api_ip_allowlist").insert({
        tenant_id: tenant.id,
        cidr_block: requiredString(body.cidr_block, "cidr_block", 64),
        note: String(body.note ?? "").trim().slice(0, 160) || null,
      }).select("id,cidr_block,note,is_active,created_at").single();
      if (error) throw new Error("IP allowlist entry could not be added");
      return json({ success: true, data }, 201);
    }

    if (action === "disable_ip_allowlist") {
      const id = requireOwnedResourceId(body.allowlist_id, "allowlist_id");
      const { data, error } = await supa.from("api_ip_allowlist")
        .update({ is_active: false }).eq("id", id).eq("tenant_id", tenant.id)
        .select("id,cidr_block,is_active").maybeSingle();
      if (error) throw new Error("IP allowlist entry could not be disabled");
      if (!data) return json({ success: false, error: "IP allowlist entry not found" }, 404);
      return json({ success: true, data });
    }

    if (action === "create_webhook_endpoint") {
      const endpointUrl = validateApiWebhookEndpointUrl(requiredString(body.endpoint_url, "endpoint_url"));
      const id = crypto.randomUUID();
      const version = 1;
      const secret = newApiWebhookSecret();
      const encrypted = await encryptApiWebhookSecret(secret, id, version);
      const { data, error } = await supa.from("api_webhook_endpoints").insert({
        id,
        tenant_id: tenant.id,
        endpoint_url: endpointUrl,
        signing_secret_hash: await sha256Hex(secret),
        signing_secret_ciphertext: encrypted.ciphertext,
        signing_secret_nonce: encrypted.nonce,
        signing_secret_version: version,
        delivery_enabled: true,
      }).select("id,endpoint_url,is_active,delivery_enabled,created_at").single();
      if (error) throw new Error("Webhook endpoint could not be created");
      return json({ success: true, data: { ...data, signing_secret: secret } }, 201);
    }

    if (action === "rotate_webhook_secret") {
      const id = requireOwnedResourceId(body.webhook_id, "webhook_id");
      const { data: current, error: currentError } = await supa.from("api_webhook_endpoints")
        .select("id,signing_secret_version").eq("id", id).eq("tenant_id", tenant.id).maybeSingle();
      if (currentError) throw new Error("Webhook endpoint could not be loaded");
      if (!current) return json({ success: false, error: "Webhook endpoint not found" }, 404);
      const version = Number(current.signing_secret_version ?? 0) + 1;
      const secret = newApiWebhookSecret();
      const encrypted = await encryptApiWebhookSecret(secret, id, version);
      const { data, error } = await supa.from("api_webhook_endpoints").update({
        signing_secret_hash: await sha256Hex(secret),
        signing_secret_ciphertext: encrypted.ciphertext,
        signing_secret_nonce: encrypted.nonce,
        signing_secret_version: version,
        delivery_enabled: true,
      }).eq("id", id).eq("tenant_id", tenant.id)
        .select("id,endpoint_url,is_active,delivery_enabled,updated_at").maybeSingle();
      if (error || !data) throw new Error("Webhook secret could not be rotated");
      return json({ success: true, data: { ...data, signing_secret: secret } });
    }

    if (action === "disable_webhook_endpoint") {
      const id = requireOwnedResourceId(body.webhook_id, "webhook_id");
      const { data, error } = await supa.from("api_webhook_endpoints")
        .update({ is_active: false, delivery_enabled: false })
        .eq("id", id).eq("tenant_id", tenant.id)
        .select("id,endpoint_url,is_active,delivery_enabled,updated_at").maybeSingle();
      if (error) throw new Error("Webhook endpoint could not be disabled");
      if (!data) return json({ success: false, error: "Webhook endpoint not found" }, 404);
      return json({ success: true, data });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Partner portal request failed";
    return json({ success: false, error: message }, 400);
  }
});
