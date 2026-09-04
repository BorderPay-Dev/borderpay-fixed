import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROD_ORIGIN = "https://portal.borderpayafrica.com";
const allowedOrigin = (origin: string | null) => {
  if (!origin) return PROD_ORIGIN;
  if (origin === PROD_ORIGIN || origin === "https://partners.borderpayafrica.com" || origin === "https://borderpay-partners.vercel.app" || origin === "http://localhost:5173") return origin;
  if (/^https:\/\/borderpay-partners-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return PROD_ORIGIN;
};
const headers = (req: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Cache-Control": "no-store",
});
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers(req), "Content-Type": "application/json" },
});

const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const countryOk = (value: unknown) => /^[A-Z]{2}$/.test(clean(value).toUpperCase());
const editable = new Set(["draft", "more_information"]);

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function completeness(app: any, people: any[], documents: any[]) {
  const entity = app?.entity_details || {};
  const operating = app?.operating_details || {};
  const compliance = app?.compliance_details || {};
  const technical = app?.technical_details || {};
  const declarations = app?.declarations || {};
  const missing: string[] = [];
  const required: Array<[unknown, string]> = [
    [entity.legal_name, "Legal business name"],
    [entity.registration_number, "Registration number"],
    [countryOk(entity.country_of_incorporation), "Country of incorporation"],
    [entity.registered_address, "Registered address"],
    [entity.operating_address, "Operating address"],
    [operating.business_model, "Business model"],
    [operating.intended_use, "Intended BorderPay use"],
    [Array.isArray(operating.corridors) && operating.corridors.length > 0, "Operating corridors"],
    [Number(operating.expected_monthly_volume_usd) > 0, "Expected monthly volume"],
    [Number(operating.expected_monthly_transactions) > 0, "Expected monthly transactions"],
    [Number(operating.maximum_transfer_usd) > 0, "Maximum transfer size"],
    [compliance.aml_program_confirmed === true, "AML program confirmation"],
    [compliance.sanctions_screening_confirmed === true, "Sanctions screening confirmation"],
    [compliance.pep_screening_confirmed === true, "PEP screening confirmation"],
    [compliance.adverse_media_confirmed === true, "Adverse-media screening confirmation"],
    [typeof compliance.regulated === "boolean", "Regulatory status"],
    [typeof compliance.nda_available === "boolean", "NDA status"],
    [technical.technical_contact_email && emailOk(technical.technical_contact_email), "Technical contact"],
    [technical.compliance_contact_email && emailOk(technical.compliance_contact_email), "Compliance contact"],
    [technical.security_contact_email && emailOk(technical.security_contact_email), "Security contact"],
    [Array.isArray(technical.static_egress_ips) && technical.static_egress_ips.length > 0, "Static egress IP"],
    [declarations.accuracy === true, "Accuracy declaration"],
    [declarations.authority === true, "Authority declaration"],
    [declarations.privacy === true, "Privacy declaration"],
  ];
  for (const [value, label] of required) if (!value) missing.push(label);
  if (!Array.isArray(app?.requested_products) || app.requested_products.length === 0) missing.push("Requested product");
  if (!people.some((person) => person.person_type === "director")) missing.push("At least one director");
  if (!people.some((person) => person.person_type === "controller")) missing.push("At least one controller");
  if (!people.some((person) => person.person_type === "ubo" && Number(person.ownership_percent) >= 20) && declarations.no_ubo_over_20 !== true) {
    missing.push("All UBOs owning 20% or more, or no-UBO declaration");
  }
  const docTypes = new Set(documents.map((doc) => doc.document_type));
  for (const [type, label] of [
    ["certificate_of_incorporation", "Certificate of incorporation"],
    ["register_of_directors", "Register of directors"],
    ["register_of_shareholders", "Register of shareholders"],
  ]) if (!docTypes.has(type)) missing.push(label);
  return missing;
}

function newApiKey(mode: "sandbox" | "production") {
  const tag = mode === "production" ? "live" : "test";
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const plain = `bpk_${tag}_${token}`;
  return { plain, prefix: plain.slice(0, 14) };
}

function newWebhookSecret() {
  return `bwhsec_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

const allowedScopes = new Set([
  "customers:write", "wallets:write", "virtual_accounts:write",
  "transfers:write", "payouts:write", "webhooks:write",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { success: false, error: "POST only" }, 405);
  if (req.headers.get("origin") && allowedOrigin(req.headers.get("origin")) !== req.headers.get("origin")) {
    return json(req, { success: false, error: "Origin not allowed" }, 403);
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) return json(req, { success: false, error: "Content-Type must be application/json" }, 415);
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 65_536) {
    return json(req, { success: false, error: "Request body is too large" }, 413);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json(req, { success: false, error: "Server configuration missing" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: any;
  try { body = await req.json(); } catch { return json(req, { success: false, error: "Invalid JSON" }, 400); }
  const action = clean(body?.action, 60);

  try {
    if (action === "request_invite") {
      const email = clean(body?.email, 254).toLowerCase();
      if (!emailOk(email)) return json(req, { success: false, error: "Valid business email required" }, 400);
      const ip = (
        req.headers.get("cf-connecting-ip") ||
        req.headers.get("x-real-ip") ||
        (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        "unknown"
      ).trim();
      const ipHash = await sha256(`${Deno.env.get("PARTNER_INVITE_HASH_SALT") || serviceKey}:${ip}`);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: rateError } = await db.from("partner_access_invite_requests").select("id", { head: true, count: "exact" }).eq("requester_ip_hash", ipHash).gte("requested_at", since);
      if (rateError) throw rateError;
      if ((count || 0) < 5) {
        const { error } = await db.from("partner_access_invite_requests").insert({ email, requester_ip_hash: ipHash, status: "pending" });
        if (error) throw error;
      }
      return json(req, { success: true, message: "Your request is queued for manual review. If approved, a secure invite will be emailed to you." });
    }

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData.user) return json(req, { success: false, error: "Authentication required" }, 401);
    const user = authData.user;

    let { data: member } = await db.from("partner_members").select("organization_id,role,is_active").eq("user_id", user.id).eq("is_active", true).maybeSingle();
    let org: any = null;
    if (member) {
      const { data } = await db.from("partner_organizations").select("*").eq("id", member.organization_id).maybeSingle();
      org = data;
    }
    if (!member || !org) {
      const email = String(user.email || "").trim().toLowerCase();
      const { data: approvedInvite } = await db.from("partner_access_invite_requests")
        .select("id,email,status").eq("email", email).eq("status", "invited")
        .order("invited_at", { ascending: false }).limit(1).maybeSingle();
      if (!approvedInvite) return json(req, { success: false, error: "Partner access has not been approved." }, 403);
      const { data: created, error } = await db.from("partner_organizations")
        .insert({ owner_user_id: user.id, primary_email: email }).select("*").single();
      if (error) throw error;
      org = created;
      const { data: createdMember, error: memberError } = await db.from("partner_members")
        .insert({ organization_id: org.id, user_id: user.id, role: "owner" })
        .select("organization_id,role,is_active").single();
      if (memberError) throw memberError;
      member = createdMember;
      await db.from("partner_access_invite_requests").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", approvedInvite.id);
    }
    if (!member?.is_active) return json(req, { success: false, error: "Partner access disabled" }, 403);
    let { data: app } = await db.from("partner_applications").select("*").eq("organization_id", org.id).in("status", ["draft", "submitted", "under_review", "more_information"]).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!app && org.status !== "approved") {
      const { data: created, error } = await db.from("partner_applications").insert({ organization_id: org.id }).select("*").single();
      if (error) throw error;
      app = created;
    }

    if (action === "get_state") {
      const [{ data: people }, { data: documents }] = await Promise.all([
        app ? db.from("partner_controlling_people").select("*").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [] }),
        app ? db.from("partner_application_documents").select("id,document_type,original_filename,mime_type,size_bytes,created_at").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [] }),
      ]);
      return json(req, { success: true, organization: org, application: app, people: people || [], documents: documents || [] });
    }

    const tenantId = String(org.approved_tenant_id || "");
    const canManage = member.role === "owner" || member.role === "admin";
    const canDevelop = canManage || member.role === "developer";
    const requireOperationalTenant = () => {
      if (org.status !== "approved") throw new Error("Partner organization is not approved");
      if (!tenantId) throw new Error("Partner API tenant has not been provisioned");
    };

    if (action === "get_workspace") {
      if (org.status !== "approved" || !tenantId) {
        return json(req, {
          success: true,
          organization: org,
          application: app,
          member,
          provisioned: false,
          tenant: null,
          api_keys: [],
          ip_allowlist: [],
          webhooks: [],
          activity: [],
          pricing: [],
          members: [],
        });
      }
      const [tenantQ, keysQ, ipsQ, hooksQ, activityQ, pricingQ, membersQ, auditQ] = await Promise.all([
        db.from("api_tenants").select("id,tenant_name,default_mode,is_active,beta_access_enabled,max_single_transfer_usd,rate_limit_per_minute,created_at,updated_at").eq("id", tenantId).maybeSingle(),
        db.from("api_keys").select("id,key_prefix,key_label,scopes,is_active,revoked_at,last_used_at,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        db.from("api_ip_allowlist").select("id,cidr_block,note,is_active,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        db.from("api_webhook_endpoints").select("id,endpoint_url,is_active,created_at,updated_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        db.from("api_request_log").select("id,request_id,method,route,status_code,error_code,latency_ms,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200),
        db.from("partner_pricing_rules").select("id,provider,product,source_currency,destination_currency,fee_type,fee_percent,fixed_amount,fixed_currency,effective_from,effective_until,is_active").eq("organization_id", org.id).eq("is_active", true).order("effective_from", { ascending: false }),
        db.from("partner_members").select("user_id,role,is_active,created_at").eq("organization_id", org.id).order("created_at"),
        db.from("partner_portal_audit_log").select("id,event_type,metadata,created_at").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(100),
      ]);
      for (const result of [tenantQ, keysQ, ipsQ, hooksQ, activityQ, pricingQ, membersQ, auditQ]) {
        if (result.error) throw result.error;
      }
      if (!tenantQ.data) return json(req, { success: false, error: "Partner API tenant is unavailable" }, 409);
      const safeMembers = await Promise.all((membersQ.data || []).map(async (row: any) => {
        const { data } = await db.auth.admin.getUserById(row.user_id);
        return { ...row, email: data?.user?.email || null };
      }));
      return json(req, {
        success: true,
        organization: org,
        application: app,
        member,
        provisioned: true,
        tenant: tenantQ.data,
        api_keys: keysQ.data || [],
        ip_allowlist: ipsQ.data || [],
        webhooks: hooksQ.data || [],
        activity: activityQ.data || [],
        pricing: pricingQ.data || [],
        members: safeMembers,
        audit_events: auditQ.data || [],
      });
    }

    if (action === "create_api_key") {
      requireOperationalTenant();
      if (!canDevelop) return json(req, { success: false, error: "Developer access required" }, 403);
      const { data: tenant } = await db.from("api_tenants").select("default_mode,is_active").eq("id", tenantId).single();
      if (!tenant?.is_active) return json(req, { success: false, error: "API access is not active yet" }, 409);
      const scopes = Array.isArray(body.scopes) ? body.scopes.map((v: unknown) => clean(v, 80)).filter((v: string) => allowedScopes.has(v)) : [];
      if (!scopes.length) return json(req, { success: false, error: "Select at least one allowed scope" }, 400);
      const key = newApiKey(tenant.default_mode === "production" ? "production" : "sandbox");
      const { data, error } = await db.from("api_keys").insert({
        tenant_id: tenantId,
        key_prefix: key.prefix,
        key_hash: await sha256(key.plain),
        key_label: clean(body.key_label, 120) || null,
        scopes,
        // Partner identities are isolated from user_profiles; attribution lives in
        // partner_portal_audit_log instead of the customer-profile foreign key.
        created_by: null,
      }).select("id,key_prefix,key_label,scopes,is_active,created_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "api_key_created", metadata: { api_key_id: data.id, scopes } });
      return json(req, { success: true, api_key: { ...data, plain_api_key: key.plain } }, 201);
    }

    if (action === "revoke_api_key") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const keyId = clean(body.key_id, 40);
      const { data, error } = await db.from("api_keys").update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("id", keyId).eq("tenant_id", tenantId).select("id,key_prefix,is_active,revoked_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "api_key_revoked", metadata: { api_key_id: keyId } });
      return json(req, { success: true, api_key: data });
    }

    if (action === "add_ip_allowlist") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const cidr = clean(body.cidr_block, 80);
      if (!cidr || !/^[0-9a-f:.]+(?:\/\d{1,3})?$/i.test(cidr)) return json(req, { success: false, error: "Valid IPv4/IPv6 CIDR required" }, 400);
      const { data, error } = await db.from("api_ip_allowlist").insert({ tenant_id: tenantId, cidr_block: cidr, note: clean(body.note, 200) || null })
        .select("id,cidr_block,note,is_active,created_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "ip_allowlist_added", metadata: { allowlist_id: data.id } });
      return json(req, { success: true, rule: data }, 201);
    }

    if (action === "remove_ip_allowlist") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const id = clean(body.id, 40);
      const { error } = await db.from("api_ip_allowlist").update({ is_active: false }).eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "ip_allowlist_removed", metadata: { allowlist_id: id } });
      return json(req, { success: true });
    }

    if (action === "create_webhook") {
      requireOperationalTenant();
      if (!canDevelop) return json(req, { success: false, error: "Developer access required" }, 403);
      const endpointUrl = clean(body.endpoint_url, 500);
      try { if (new URL(endpointUrl).protocol !== "https:") throw new Error(); } catch { return json(req, { success: false, error: "A valid HTTPS webhook URL is required" }, 400); }
      const secret = newWebhookSecret();
      const { data, error } = await db.from("api_webhook_endpoints").insert({ tenant_id: tenantId, endpoint_url: endpointUrl, signing_secret_hash: await sha256(secret) })
        .select("id,endpoint_url,is_active,created_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "webhook_created", metadata: { webhook_id: data.id } });
      return json(req, { success: true, webhook: { ...data, signing_secret: secret } }, 201);
    }

    if (action === "rotate_webhook_secret") {
      requireOperationalTenant();
      if (!canDevelop) return json(req, { success: false, error: "Developer access required" }, 403);
      const id = clean(body.webhook_id, 40);
      const secret = newWebhookSecret();
      const { data, error } = await db.from("api_webhook_endpoints").update({ signing_secret_hash: await sha256(secret) })
        .eq("id", id).eq("tenant_id", tenantId).select("id,endpoint_url,is_active,updated_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "webhook_secret_rotated", metadata: { webhook_id: id } });
      return json(req, { success: true, webhook: { ...data, signing_secret: secret } });
    }

    if (action === "disable_webhook") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const id = clean(body.webhook_id, 40);
      const { error } = await db.from("api_webhook_endpoints").update({ is_active: false }).eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "webhook_disabled", metadata: { webhook_id: id } });
      return json(req, { success: true });
    }

    if (!app) return json(req, { success: false, error: "No active application" }, 409);
    if (!editable.has(app.status)) return json(req, { success: false, error: "Application is read-only during review" }, 409);

    if (action === "save_application") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of ["entity_details", "operating_details", "compliance_details", "technical_details", "declarations"]) {
        if (body[key] && typeof body[key] === "object" && !Array.isArray(body[key])) patch[key] = body[key];
      }
      if (Array.isArray(body.requested_products)) patch.requested_products = body.requested_products.filter((v: unknown) => v === "api" || v === "white_label");
      const entity: any = patch.entity_details;
      if (entity) {
        if (entity.country_of_incorporation && !countryOk(entity.country_of_incorporation)) return json(req, { success: false, error: "Country must be ISO-2" }, 400);
        await db.from("partner_organizations").update({ legal_name: clean(entity.legal_name, 200) || null, trading_name: clean(entity.trading_name, 200) || null, website: clean(entity.website, 500) || null, country_of_incorporation: clean(entity.country_of_incorporation, 2).toUpperCase() || null, registration_number: clean(entity.registration_number, 120) || null, updated_at: new Date().toISOString() }).eq("id", org.id);
      }
      const { data, error } = await db.from("partner_applications").update(patch).eq("id", app.id).select("*").single();
      if (error) throw error;
      return json(req, { success: true, application: data });
    }
    if (action === "upsert_person") {
      const payload = {
        application_id: app.id,
        person_type: clean(body.person_type, 20), full_name: clean(body.full_name, 200), date_of_birth: clean(body.date_of_birth, 10),
        nationality: clean(body.nationality, 2).toUpperCase(), country_of_residence: clean(body.country_of_residence, 2).toUpperCase(),
        residential_address: clean(body.residential_address, 1000), ownership_percent: body.person_type === "ubo" ? Number(body.ownership_percent) : null,
        is_politically_exposed: body.is_politically_exposed === true, updated_at: new Date().toISOString(),
      };
      if (!payload.full_name || !countryOk(payload.nationality) || !countryOk(payload.country_of_residence) || !payload.residential_address) return json(req, { success: false, error: "Complete person details required" }, 400);
      const id = clean(body.id, 40);
      const query = id ? db.from("partner_controlling_people").update(payload).eq("id", id).eq("application_id", app.id) : db.from("partner_controlling_people").insert(payload);
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      return json(req, { success: true, person: data });
    }
    if (action === "delete_person") {
      const { error } = await db.from("partner_controlling_people").delete().eq("id", clean(body.id, 40)).eq("application_id", app.id);
      if (error) throw error;
      return json(req, { success: true });
    }
    if (action === "create_document_upload") {
      const type = clean(body.document_type, 80);
      const mime = clean(body.mime_type, 80);
      const size = Number(body.size_bytes);
      if (!/^[a-z_]+$/.test(type) || !["application/pdf", "image/jpeg", "image/png"].includes(mime) || !(size > 0 && size <= 10485760)) return json(req, { success: false, error: "PDF, JPG, or PNG up to 10 MB required" }, 400);
      const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
      const path = `${org.id}/${app.id}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from("partner-due-diligence").createSignedUploadUrl(path);
      if (error) throw error;
      return json(req, { success: true, path, token: data.token, signed_url: data.signedUrl });
    }
    if (action === "finalize_document") {
      const path = clean(body.storage_path, 500);
      if (!path.startsWith(`${org.id}/${app.id}/`)) return json(req, { success: false, error: "Invalid document path" }, 400);
      const filename = path.split("/").pop() || "";
      const folder = `${org.id}/${app.id}`;
      const { data: stored, error: storageError } = await db.storage.from("partner-due-diligence").list(folder, {
        search: filename,
        limit: 2,
      });
      if (storageError) throw storageError;
      const object = (stored || []).find((entry: any) => entry.name === filename);
      if (!object) return json(req, { success: false, error: "Uploaded document was not found" }, 409);
      const declaredSize = Number(body.size_bytes);
      const storedSize = Number(object.metadata?.size ?? object.metadata?.contentLength ?? 0);
      if (!(declaredSize > 0 && declaredSize <= 10_485_760) || (storedSize > 0 && storedSize !== declaredSize)) {
        return json(req, { success: false, error: "Uploaded document size does not match" }, 409);
      }
      const payload = { application_id: app.id, document_type: clean(body.document_type, 80), storage_path: path, original_filename: clean(body.original_filename, 240), mime_type: clean(body.mime_type, 80), size_bytes: Number(body.size_bytes), uploaded_by: user.id };
      const { data, error } = await db.from("partner_application_documents").insert(payload).select("id,document_type,original_filename,mime_type,size_bytes,created_at").single();
      if (error) throw error;
      return json(req, { success: true, document: data });
    }
    if (action === "submit_application") {
      const [{ data: people }, { data: documents }] = await Promise.all([
        db.from("partner_controlling_people").select("*").eq("application_id", app.id),
        db.from("partner_application_documents").select("*").eq("application_id", app.id),
      ]);
      const missing = completeness(app, people || [], documents || []);
      if (missing.length) return json(req, { success: false, error: "Application incomplete", missing }, 422);
      const now = new Date().toISOString();
      const { error } = await db.from("partner_applications").update({ status: "submitted", submitted_at: now, updated_at: now }).eq("id", app.id);
      if (error) throw error;
      await db.from("partner_organizations").update({ status: "submitted", updated_at: now }).eq("id", org.id);
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, application_id: app.id, actor_user_id: user.id, event_type: "application_submitted" });
      return json(req, { success: true, status: "submitted" });
    }
    return json(req, { success: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("partner-onboarding", error);
    return json(req, { success: false, error: "Partner request failed" }, 500);
  }
});
