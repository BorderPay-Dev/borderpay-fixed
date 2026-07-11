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

type Branding = {
  app_name: string;
  logo_url: string | null;
  primary_color: string;
  background_color: string;
  background_accent: string;
};

const DEFAULT_BRANDING: Branding = {
  app_name: "BorderPay",
  logo_url: null,
  primary_color: "#C7FF00",
  background_color: "#0B0E11",
  background_accent: "#1A1F26",
};

function cleanText(v: unknown, fallback = ""): string {
  return String(v ?? fallback).trim().replace(/\s+/g, " ");
}

function cleanColor(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

function cleanUrl(v: unknown): string | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return raw;
  } catch {
    return null;
  }
}

function normalizeBranding(input: any, previous?: Partial<Branding>): Branding {
  const base = { ...DEFAULT_BRANDING, ...(previous || {}) };
  const appName = cleanText(input?.app_name, base.app_name).slice(0, 40);
  return {
    app_name: appName || DEFAULT_BRANDING.app_name,
    logo_url: input?.logo_url === undefined ? base.logo_url ?? null : cleanUrl(input.logo_url),
    primary_color: cleanColor(input?.primary_color, base.primary_color),
    background_color: cleanColor(input?.background_color, base.background_color),
    background_accent: cleanColor(input?.background_accent, base.background_accent),
  };
}

async function resolveBusinessTenant(supa: any, userId: string): Promise<
  | { tenant: any; business: any; error?: never }
  | { error: Response; tenant?: never; business?: never }
> {
  const { data: business, error: bizErr } = await supa
    .from("business_profiles")
    .select("user_id, company_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (bizErr) throw new Error(bizErr.message);
  if (!business) return { error: json({ success: false, error: "Business account required" }, 403) };

  const { data: existing, error: existingErr } = await supa
    .from("api_tenants")
    .select("id, tenant_name, business_user_id, metadata")
    .eq("business_user_id", userId)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  if (existing) return { tenant: existing, business };

  const tenantName = cleanText(business.company_name, "Business account");
  const { data: created, error: createErr } = await supa
    .from("api_tenants")
    .insert({
      business_user_id: userId,
      tenant_name: tenantName,
      default_mode: "sandbox",
      is_active: true,
      metadata: {
        white_label: {
          ...DEFAULT_BRANDING,
          app_name: tenantName.slice(0, 40) || DEFAULT_BRANDING.app_name,
        },
      },
    })
    .select("id, tenant_name, business_user_id, metadata")
    .single();
  if (createErr) throw new Error(createErr.message);
  return { tenant: created, business };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ success: false, error: "Server configuration missing" }, 500);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);

  const { data: auth, error: authErr } = await supa.auth.getUser(token);
  if (authErr || !auth?.user) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    const contentType = req.headers.get("content-type") || "";
    const actionFromQuery = new URL(req.url).searchParams.get("action") || "";
    let action = actionFromQuery;
    let payload: any = {};
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      action = cleanText(form.get("action"), action || "upload_logo");
      file = form.get("file") as File | null;
    } else {
      payload = await req.json().catch(() => ({}));
      action = cleanText(payload?.action, "get");
    }

    const resolved = await resolveBusinessTenant(supa, auth.user.id);
    if (resolved.error) return resolved.error;
    const tenant = resolved.tenant;
    const metadata = tenant.metadata && typeof tenant.metadata === "object" ? tenant.metadata : {};
    const current = normalizeBranding(metadata.white_label || {}, {
      app_name: tenant.tenant_name || DEFAULT_BRANDING.app_name,
    });

    if (action === "get") {
      return json({ success: true, data: { tenant_id: tenant.id, branding: current } });
    }

    if (action === "save") {
      const branding = normalizeBranding(payload?.branding || payload || {}, current);
      const nextMetadata = { ...metadata, white_label: branding };
      const { data, error } = await supa
        .from("api_tenants")
        .update({
          tenant_name: branding.app_name,
          metadata: nextMetadata,
        })
        .eq("id", tenant.id)
        .select("id, tenant_name, metadata, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return json({ success: true, data: { tenant_id: data.id, branding } });
    }

    if (action === "upload_logo") {
      if (!file) return json({ success: false, error: "Logo file is required" }, 400);
      if (file.size > 1024 * 1024) {
        return json({ success: false, error: "Logo must be 1MB or smaller" }, 400);
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      if (!["png", "jpg", "jpeg", "webp", "svg"].includes(ext)) {
        return json({ success: false, error: "Logo must be PNG, JPG, WEBP, or SVG" }, 400);
      }
      const contentType = file.type || (ext === "svg" ? "image/svg+xml" : "application/octet-stream");
      if (!contentType.startsWith("image/")) {
        return json({ success: false, error: "Logo must be an image" }, 400);
      }

      const path = `white-label/${auth.user.id}/logo.${ext}`;
      const { error: uploadErr } = await supa.storage
        .from("profile-pictures")
        .upload(path, await file.arrayBuffer(), {
          contentType,
          upsert: true,
        });
      if (uploadErr) throw new Error(uploadErr.message);

      const { data: publicUrl } = supa.storage.from("profile-pictures").getPublicUrl(path);
      const branding = normalizeBranding({ ...current, logo_url: publicUrl.publicUrl }, current);
      const { error: updateErr } = await supa
        .from("api_tenants")
        .update({ metadata: { ...metadata, white_label: branding } })
        .eq("id", tenant.id);
      if (updateErr) throw new Error(updateErr.message);

      return json({ success: true, data: { tenant_id: tenant.id, branding } });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : "White-label branding failed",
    }, 500);
  }
});
