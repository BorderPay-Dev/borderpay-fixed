import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function normalizeWindowMinutes(v: unknown): number {
  const n = Number(v ?? 15);
  if (!Number.isFinite(n)) return 15;
  return Math.max(1, Math.min(1440, Math.floor(n)));
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

function newWebhookSecret(): string {
  return `bwhsec_${crypto.randomUUID().replaceAll("-", "")}${
    crypto.randomUUID().replaceAll("-", "")
  }`;
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
      const { data, error } = await supa
        .from("api_tenants")
        .select(
          "id, business_user_id, tenant_name, default_mode, is_active, beta_access_enabled, max_single_transfer_usd, rate_limit_per_minute, metadata, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    if (action === "upsert_tenant") {
      const tenantId = String(body?.tenant_id || "").trim();
      const payload = {
        business_user_id: body?.business_user_id
          ? String(body.business_user_id)
          : null,
        tenant_name: requireString(body?.tenant_name, "tenant_name"),
        default_mode: normalizeMode(body?.default_mode),
        is_active: body?.is_active === false ? false : true,
        beta_access_enabled: body?.beta_access_enabled === true,
        max_single_transfer_usd: body?.max_single_transfer_usd == null
          ? null
          : Math.max(1, Number(body.max_single_transfer_usd)),
        rate_limit_per_minute: Math.max(
          1,
          Math.min(5000, Number(body?.rate_limit_per_minute || 120)),
        ),
        metadata: typeof body?.metadata === "object" && body.metadata
          ? body.metadata
          : {},
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

      const mode = normalizeMode(tenant.default_mode);
      const key = newApiKey(mode);
      const keyHash = await sha256Hex(key.plain);

      const { data, error } = await supa
        .from("api_keys")
        .insert({
          tenant_id: tenantId,
          key_prefix: key.prefix,
          key_hash: keyHash,
          key_label: String(body?.key_label || "").trim() || null,
          scopes: normalizeScopes(body?.scopes),
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
      const endpointUrl = requireString(body?.endpoint_url, "endpoint_url");
      const secret = newWebhookSecret();
      const secretHash = await sha256Hex(secret);

      const { data, error } = await supa
        .from("api_webhook_endpoints")
        .insert({
          tenant_id: tenantId,
          endpoint_url: endpointUrl,
          signing_secret_hash: secretHash,
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
      const secret = newWebhookSecret();
      const secretHash = await sha256Hex(secret);

      const { data, error } = await supa
        .from("api_webhook_endpoints")
        .update({ signing_secret_hash: secretHash })
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
          "id, tenant_id, endpoint_url, is_active, created_at, updated_at",
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
