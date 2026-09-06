import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractPublicClientIp, readBoundedJson } from "../_shared/public-request-security.ts";
import { encryptApiWebhookSecret, newApiWebhookSecret, validateApiWebhookEndpointUrl } from "../_shared/api-webhook-security.ts";

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
const mfaProtectedActions = new Set([
  "create_project", "save_workspace_settings", "create_api_key", "revoke_api_key",
  "upload_white_label_logo",
  "add_ip_allowlist", "remove_ip_allowlist", "create_webhook", "rotate_webhook_secret", "disable_webhook",
  "invite_team_member", "update_team_member", "remove_team_member",
]);

function tokenAal(token: string): string {
  try {
    const encoded = token.split(".")[1] || "";
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return clean(JSON.parse(atob(padded))?.aal, 10).toLowerCase();
  } catch {
    return "";
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function completeness(app: any, people: any[], documents: any[], organization: any) {
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
  const commonDocuments = [
    ["aml_policy", "AML/CFT policy"],
    ["sanctions_policy", "Sanctions policy"],
    ["privacy_policy", "Privacy policy"],
    ["security_policy", "Information-security policy"],
    ["incident_response_policy", "Incident-response policy"],
    ["bank_statement", "Business bank statement"],
  ];
  const manualIdentityDocuments = [
    ["certificate_of_incorporation", "Certificate of incorporation"],
    ["articles_of_association", "Articles of association"],
    ["register_of_directors", "Register of directors"],
    ["register_of_shareholders", "Register of shareholders"],
    ["ownership_chart", "Ownership structure chart"],
    ["proof_of_registered_address", "Proof of registered address"],
    ["director_identity", "Director identity document"],
    ["financial_statement", "Latest financial statement"],
    ["source_of_funds", "Source-of-funds evidence"],
  ];
  for (const [type, label] of commonDocuments) if (!docTypes.has(type)) missing.push(label);
  if (organization?.kyb_source !== "bridge_verified") {
    for (const [type, label] of manualIdentityDocuments) if (!docTypes.has(type)) missing.push(label);
    if (people.some((person) => person.person_type === "ubo")) {
      if (!docTypes.has("ubo_identity")) missing.push("UBO identity document");
      if (!docTypes.has("ubo_address")) missing.push("UBO proof of address");
    }
  }
  if (compliance.regulated === true && !docTypes.has("operating_licence")) missing.push("Operating licence");
  if (compliance.nda_available === true && !docTypes.has("nda")) missing.push("NDA");
  return missing;
}

function newApiKey(mode: "sandbox" | "production") {
  const tag = mode === "production" ? "live" : "test";
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const plain = `bpk_${tag}_${token}`;
  return { plain, prefix: plain.slice(0, 14) };
}

const allowedScopes = new Set([
  "customers:write", "wallets:write", "virtual_accounts:write",
  "transfers:write", "payouts:write", "webhooks:write", "onboarding:write",
]);

const WHITE_LABEL_LOGO_BUCKET = "tenant-assets";
function decodeWhiteLabelLogo(value: unknown) {
  const match = typeof value === "string"
    ? value.trim().match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i)
    : null;
  if (!match) throw new Error("Logo must be a PNG, JPEG, or WebP data URL");
  let binary = "";
  try { binary = atob(match[2].replace(/\s+/g, "")); } catch { throw new Error("Logo file is invalid"); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.byteLength || bytes.byteLength > 1_048_576) throw new Error("Logo must be 1MB or smaller");
  const type = match[1].toLowerCase();
  const signatureOk = type === "image/png"
    ? [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((x, i) => bytes[i] === x)
    : type === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : [0x52,0x49,0x46,0x46].every((x, i) => bytes[i] === x) && [0x57,0x45,0x42,0x50].every((x, i) => bytes[i + 8] === x);
  if (!signatureOk) throw new Error("Logo content does not match its file type");
  return { bytes, contentType: type, ext: type === "image/jpeg" ? "jpg" : type.split("/")[1] };
}

const inviteBuckets = new Map<string, { count: number; resetAt: number }>();
type GoogleServiceAccount = { client_email: string; private_key: string };
let googleTokenCache: { value: string; expiresAt: number } | null = null;
function base64Url(value: Uint8Array | string): string {
  const binary = typeof value === "string" ? value : String.fromCharCode(...value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function pemBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}
async function googleAccessToken(raw: string): Promise<string> {
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now() + 60_000) return googleTokenCache.value;
  const account = JSON.parse(raw) as GoogleServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error("Google service account is incomplete");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claims}`;
  const keyBytes = pemBytes(account.private_key);
  const key = await crypto.subtle.importKey("pkcs8", keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(signature)}` }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !(payload as any)?.access_token) throw new Error("Google OAuth token could not be issued");
  googleTokenCache = { value: String((payload as any).access_token), expiresAt: Date.now() + Number((payload as any).expires_in || 3600) * 1000 };
  return googleTokenCache.value;
}
function allowInviteAttempt(keys: string[], now = Date.now()) {
  if (inviteBuckets.size > 5_000) {
    for (const [key, bucket] of inviteBuckets) if (bucket.resetAt <= now) inviteBuckets.delete(key);
    while (inviteBuckets.size > 5_000) {
      const oldest = inviteBuckets.keys().next().value;
      if (typeof oldest !== "string") break;
      inviteBuckets.delete(oldest);
    }
  }
  for (const key of keys) {
    const bucket = inviteBuckets.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= 5) return false;
  }
  for (const key of keys) {
    const bucket = inviteBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) inviteBuckets.set(key, { count: 1, resetAt: now + 60 * 60 * 1_000 });
    else bucket.count += 1;
  }
  return true;
}

async function verifyPartnerInviteCaptcha(token: string, remoteIp: string | null) {
  const projectId = Deno.env.get("RECAPTCHA_ENTERPRISE_PROJECT_ID") || "";
  const apiKey = Deno.env.get("RECAPTCHA_ENTERPRISE_API_KEY") || "";
  const serviceAccount = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
  const siteKey = Deno.env.get("PARTNER_RECAPTCHA_ENTERPRISE_SITE_KEY") || "";
  const required = (Deno.env.get("PARTNER_INVITE_CAPTCHA_REQUIRED") || "false").toLowerCase() === "true";
  if (!projectId || (!apiKey && !serviceAccount) || !siteKey) return !required;
  if (!token) return !required;
  try {
    const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) authHeaders["X-Goog-Api-Key"] = apiKey;
    else authHeaders.Authorization = `Bearer ${await googleAccessToken(serviceAccount)}`;
    const response = await fetch(
      `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/assessments`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          event: {
            token,
            siteKey,
            expectedAction: "PARTNER_INVITE",
            ...(remoteIp ? { userIpAddress: remoteIp } : {}),
          },
        }),
      },
    );
    const assessment = await response.json().catch(() => ({})) as {
      tokenProperties?: { valid?: boolean; action?: string; hostname?: string };
      riskAnalysis?: { score?: number };
    };
    const score = Number(assessment.riskAnalysis?.score ?? -1);
    return response.ok &&
      assessment.tokenProperties?.valid === true &&
      assessment.tokenProperties?.action === "PARTNER_INVITE" &&
      String(assessment.tokenProperties?.hostname || "").toLowerCase() === "portal.borderpayafrica.com" &&
      Number.isFinite(score) && score >= 0.7;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { success: false, error: "POST only" }, 405);
  if (req.headers.get("origin") && allowedOrigin(req.headers.get("origin")) !== req.headers.get("origin")) {
    return json(req, { success: false, error: "Origin not allowed" }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json(req, { success: false, error: "Server configuration missing" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const envelope = await readBoundedJson<any>(req, 65_536);
  if (!envelope.ok) return json(req, { success: false, code: envelope.code, error: envelope.error }, envelope.status);
  const body = envelope.value;
  const action = clean(body?.action, 60);

  try {
    if (action === "request_invite") {
      const email = clean(body?.email, 254).toLowerCase();
      if (!emailOk(email)) return json(req, { success: false, error: "Valid business email required" }, 400);
      const ip = extractPublicClientIp(req) || "unknown";
      if (!allowInviteAttempt([`ip:${ip}`, `email:${email}`])) {
        return json(req, { success: false, code: "rate_limited", error: "Too many requests. Please try again later." }, 429);
      }
      if (!await verifyPartnerInviteCaptcha(clean(body?.captcha_token, 8_192), ip === "unknown" ? null : ip)) {
        return json(req, { success: false, code: "captcha_failed", error: "Request verification failed. Please retry." }, 403);
      }
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
      const { data: teamInvite } = await db.from("partner_team_invitations")
        .select("id,organization_id,role,status").eq("email", email).eq("status", "invited")
        .order("invited_at", { ascending: false }).limit(1).maybeSingle();
      if (teamInvite) {
        const { data: invitedOrg } = await db.from("partner_organizations")
          .select("*").eq("id", teamInvite.organization_id).eq("status", "approved").maybeSingle();
        if (!invitedOrg) return json(req, { success: false, error: "Partner organization is not active." }, 403);
        const { data: joined, error: joinError } = await db.from("partner_members")
          .insert({ organization_id: teamInvite.organization_id, user_id: user.id, role: teamInvite.role })
          .select("organization_id,role,is_active").single();
        if (joinError) throw joinError;
        await db.from("partner_team_invitations").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", teamInvite.id);
        member = joined;
        org = invitedOrg;
      }
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
    if (!app && org.status === "approved") {
      const { data: latest } = await db.from("partner_applications").select("*")
        .eq("organization_id", org.id).order("version", { ascending: false }).limit(1).maybeSingle();
      app = latest;
    }

    if (action === "get_state") {
      const [{ data: people }, { data: documents }] = await Promise.all([
        app ? db.from("partner_controlling_people").select("*").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [] }),
        app ? db.from("partner_application_documents").select("id,document_type,original_filename,mime_type,size_bytes,created_at").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [] }),
      ]);
      return json(req, { success: true, organization: org, application: app, people: people || [], documents: documents || [] });
    }

    const canManage = member.role === "owner" || member.role === "admin";
    const canDevelop = canManage || member.role === "developer";
    const { data: securitySettings } = await db.from("partner_workspace_settings")
      .select("two_factor_required").eq("organization_id", org.id).maybeSingle();
    if (securitySettings?.two_factor_required === true && mfaProtectedActions.has(action) && tokenAal(token) !== "aal2") {
      return json(req, { success: false, error: "Two-factor authentication is required for this action" }, 403);
    }
    const { data: projects, error: projectsError } = await db.from("partner_projects")
      .select("id,tenant_id,name,slug,environment,status,created_at,updated_at")
      .eq("organization_id", org.id).order("created_at");
    if (projectsError) throw projectsError;
    const requestedProjectId = clean(body.project_id, 40);
    const selectedProject = requestedProjectId
      ? (projects || []).find((project: any) => project.id === requestedProjectId)
      : (projects || []).find((project: any) => project.tenant_id === org.approved_tenant_id) || (projects || [])[0];
    if (requestedProjectId && !selectedProject) return json(req, { success: false, error: "Project not found" }, 404);
    const tenantId = String(selectedProject ? (selectedProject.tenant_id || "") : (org.approved_tenant_id || ""));
    const requireOperationalTenant = () => {
      if (org.status !== "approved") throw new Error("Partner organization is not approved");
      if (!tenantId) throw new Error("Partner API tenant has not been provisioned");
    };
    const loadTenantApproval = async (id = tenantId) => {
      if (!id) return null;
      const { data, error } = await db.from("api_partner_approvals")
        .select("status,approved_products,partner_type,approved_use_case,technical_contact_email,compliance_contact_email,incident_contact_email,compliance_approval_reference,engineering_approval_reference,compliance_approved_by,engineering_approved_by,recorded_by,approved_at")
        .eq("tenant_id", id).maybeSingle();
      if (error) throw error;
      return data;
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
          projects: projects || [],
          resources: [],
          settings: null,
          support_tickets: [],
        });
      }
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const [tenantQ, approvalQ, keysQ, ipsQ, hooksQ, activityQ, pricingQ, membersQ, invitesQ, auditQ, resourcesQ, settingsQ, ticketsQ, peopleQ, emailUsageQ] = await Promise.all([
        db.from("api_tenants").select("id,tenant_name,default_mode,is_active,beta_access_enabled,max_single_transfer_usd,rate_limit_per_minute,metadata,created_at,updated_at").eq("id", tenantId).maybeSingle(),
        db.from("api_partner_approvals").select("status,approved_products,approved_at").eq("tenant_id", tenantId).maybeSingle(),
        db.from("api_keys").select("id,key_prefix,key_label,scopes,is_active,revoked_at,last_used_at,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        db.from("api_ip_allowlist").select("id,cidr_block,note,is_active,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        db.from("api_webhook_endpoints").select("id,endpoint_url,is_active,delivery_enabled,event_types,created_at,updated_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
        db.from("api_request_log").select("id,request_id,method,route,status_code,error_code,latency_ms,created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200),
        db.from("partner_pricing_rules").select("id,provider,product,source_currency,destination_currency,fee_type,fee_percent,fixed_amount,fixed_currency,effective_from,effective_until,is_active").eq("organization_id", org.id).eq("is_active", true).order("effective_from", { ascending: false }),
        db.from("partner_members").select("user_id,role,is_active,created_at").eq("organization_id", org.id).order("created_at"),
        db.from("partner_team_invitations").select("id,email,role,status,invited_at,accepted_at,revoked_at").eq("organization_id", org.id).order("invited_at", { ascending: false }).limit(100),
        db.from("partner_portal_audit_log").select("id,event_type,metadata,created_at").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(100),
        db.from("api_tenant_resources").select("id,resource_type,provider_resource_id,customer_provider_id,state,amount,source_currency,destination_currency,display_name,external_reference,safe_metadata,created_at,updated_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500),
        db.from("partner_workspace_settings").select("brand_name,primary_color,support_email,billing_email,payout_contact_email,email_sender_name,email_reply_to,two_factor_required,updated_at").eq("organization_id", org.id).maybeSingle(),
        db.from("partner_support_tickets").select("id,project_id,category,subject,message,status,created_at,updated_at").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(100),
        app ? db.from("partner_controlling_people").select("id,person_type,full_name,nationality,country_of_residence,ownership_percent,is_politically_exposed,created_at").eq("application_id", app.id).order("created_at") : Promise.resolve({ data: [], error: null }),
        db.from("partner_email_usage_events").select("delivery_status,billable,units,created_at").eq("tenant_id", tenantId).gte("created_at", monthStart).limit(5000),
      ]);
      for (const result of [tenantQ, approvalQ, keysQ, ipsQ, hooksQ, activityQ, pricingQ, membersQ, invitesQ, auditQ, resourcesQ, settingsQ, ticketsQ, peopleQ, emailUsageQ]) {
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
        approval: approvalQ.data,
        api_keys: keysQ.data || [],
        ip_allowlist: ipsQ.data || [],
        webhooks: hooksQ.data || [],
        activity: activityQ.data || [],
        pricing: pricingQ.data || [],
        members: safeMembers,
        team_invitations: invitesQ.data || [],
        audit_events: auditQ.data || [],
        projects: projects || [],
        selected_project: selectedProject || null,
        resources: resourcesQ.data || [],
        settings: settingsQ.data || null,
        support_tickets: ticketsQ.data || [],
        controlling_people: peopleQ.data || [],
        email_usage: {
          month_started_at: monthStart,
          delivered: (emailUsageQ.data || []).filter((row: any) => row.delivery_status === "sent").reduce((sum: number, row: any) => sum + Number(row.units || 0), 0),
          failed: (emailUsageQ.data || []).filter((row: any) => row.delivery_status === "failed").length,
          billable_units: (emailUsageQ.data || []).filter((row: any) => row.billable === true).reduce((sum: number, row: any) => sum + Number(row.units || 0), 0),
        },
      });
    }

    if (action === "create_project") {
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      if (org.status !== "approved") return json(req, { success: false, error: "Partner approval required before creating projects" }, 409);
      const name = clean(body.name, 120);
      const slug = clean(body.slug, 60).toLowerCase();
      if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return json(req, { success: false, error: "Project name and lowercase URL-safe slug required" }, 400);
      }
      const sourceApproval = await loadTenantApproval(String(org.approved_tenant_id || ""));
      if (!sourceApproval || sourceApproval.status !== "approved" || !Array.isArray(sourceApproval.approved_products) || !sourceApproval.approved_products.length) {
        return json(req, { success: false, error: "The approved organization products could not be inherited by this sandbox project" }, 409);
      }
      const { data, error } = await db.from("partner_projects").insert({
        organization_id: org.id, name, slug, environment: "sandbox", status: "pending", created_by: user.id,
      }).select("id,tenant_id,name,slug,environment,status,created_at").single();
      if (error) throw error;
      const { data: tenant, error: tenantError } = await db.from("api_tenants").insert({
        tenant_name: `${org.legal_name || org.primary_email} · ${name}`,
        default_mode: "sandbox", is_active: true, beta_access_enabled: true,
        metadata: { partner_organization_id: org.id, partner_project_id: data.id, pricing_source: "partner_custom_only", production_access: false },
      }).select("id").single();
      if (tenantError) throw tenantError;
      const { data: activated, error: activateError } = await db.from("partner_projects")
        .update({ tenant_id: tenant.id, status: "active" }).eq("id", data.id).eq("organization_id", org.id)
        .select("id,tenant_id,name,slug,environment,status,created_at").single();
      if (activateError) throw activateError;
      const { error: approvalCloneError } = await db.from("api_partner_approvals").insert({
        ...sourceApproval,
        tenant_id: tenant.id,
        compliance_approval_reference: `${sourceApproval.compliance_approval_reference}:sandbox:${data.id}`,
        engineering_approval_reference: `${sourceApproval.engineering_approval_reference}:sandbox:${data.id}`,
        recorded_by: `partner-portal:${user.id}`,
      });
      if (approvalCloneError) {
        await db.from("partner_projects").update({ status: "disabled" }).eq("id", data.id);
        await db.from("api_tenants").update({ is_active: false }).eq("id", tenant.id);
        throw new Error("Sandbox project approval inheritance failed");
      }
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "sandbox_project_created", metadata: { project_id: data.id, tenant_id: tenant.id, production_access: false } });
      return json(req, { success: true, project: activated, production_access: false }, 201);
    }

    if (action === "save_workspace_settings") {
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      requireOperationalTenant();
      const color = clean(body.primary_color, 7);
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) return json(req, { success: false, error: "Primary color must be a six-digit hex color" }, 400);
      const emailDeliveryMode = clean(body.email_delivery_mode, 32) || "borderpay_managed";
      if (!new Set(["borderpay_managed", "partner_webhook"]).has(emailDeliveryMode)) {
        return json(req, { success: false, error: "Email delivery mode is invalid" }, 400);
      }
      const emailFields = ["support_email", "billing_email", "payout_contact_email", "email_reply_to"];
      for (const field of emailFields) {
        const value = clean(body[field], 254);
        if (value && !emailOk(value)) return json(req, { success: false, error: `${field} must be a valid email` }, 400);
      }
      const tenantIds = (projects || []).map((project: any) => String(project.tenant_id || "")).filter(Boolean);
      const approvedTenantIds: string[] = [];
      for (const id of tenantIds) {
        const approval = await loadTenantApproval(id);
        if (approval?.status === "approved" && Array.isArray(approval.approved_products) && approval.approved_products.includes("white_label")) {
          approvedTenantIds.push(id);
        }
      }
      if (!approvedTenantIds.length) {
        return json(req, { success: false, error: "White-label product approval is required before publishing branding" }, 403);
      }
      if (emailDeliveryMode === "partner_webhook") {
        for (const id of approvedTenantIds) {
          const { data: emailEndpoints, error: webhookCheckError } = await db.from("api_webhook_endpoints")
            .select("event_types,delivery_enabled").eq("tenant_id", id).eq("is_active", true);
          if (webhookCheckError) throw webhookCheckError;
          const canDeliverEmail = (emailEndpoints || []).some((endpoint: any) => endpoint.delivery_enabled === true &&
            (!Array.isArray(endpoint.event_types) || endpoint.event_types.length === 0 || endpoint.event_types.includes("email.delivery_requested")));
          if (!canDeliverEmail) return json(req, { success: false, error: "Add an active webhook subscribed to email.delivery_requested on every approved project before selecting partner-managed email" }, 409);
        }
      }
      const payload = {
        organization_id: org.id,
        brand_name: clean(body.brand_name, 120) || null,
        primary_color: color || null,
        support_email: clean(body.support_email, 254) || null,
        billing_email: clean(body.billing_email, 254) || null,
        payout_contact_email: clean(body.payout_contact_email, 254) || null,
        email_sender_name: clean(body.email_sender_name, 120) || null,
        email_reply_to: clean(body.email_reply_to, 254) || null,
        two_factor_required: body.two_factor_required === true,
        updated_by: user.id,
      };
      const { data, error } = await db.from("partner_workspace_settings").upsert(payload, { onConflict: "organization_id" }).select("brand_name,primary_color,support_email,billing_email,payout_contact_email,email_sender_name,email_reply_to,two_factor_required,updated_at").single();
      if (error) throw error;
      for (const id of approvedTenantIds) {
        const { data: tenantRow, error: tenantReadError } = await db.from("api_tenants").select("metadata").eq("id", id).single();
        if (tenantReadError) throw tenantReadError;
        const metadata = tenantRow?.metadata && typeof tenantRow.metadata === "object" ? tenantRow.metadata : {};
        const oldWhiteLabel = (metadata as any).white_label && typeof (metadata as any).white_label === "object" ? (metadata as any).white_label : {};
        const oldOnboarding = (metadata as any).onboarding && typeof (metadata as any).onboarding === "object" ? (metadata as any).onboarding : {};
        const { error: publishError } = await db.from("api_tenants").update({
          metadata: {
            ...metadata,
            onboarding: { ...oldOnboarding, white_label_signup_enabled: true },
            white_label: {
              ...oldWhiteLabel,
              enabled: true,
              brand_name: data.brand_name,
              app_name: data.brand_name,
              primary_color: data.primary_color,
              support_email: data.support_email,
              email_sender_name: data.email_sender_name,
              email_reply_to: data.email_reply_to,
              email_delivery_mode: emailDeliveryMode,
            },
          },
        }).eq("id", id);
        if (publishError) throw publishError;
      }
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "workspace_settings_updated", metadata: { published_tenant_count: approvedTenantIds.length } });
      return json(req, { success: true, settings: data });
    }

    if (action === "upload_white_label_logo") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const approval = await loadTenantApproval();
      if (approval?.status !== "approved" || !Array.isArray(approval.approved_products) || !approval.approved_products.includes("white_label")) {
        return json(req, { success: false, error: "White-label product approval is required before uploading branding" }, 403);
      }
      const logo = decodeWhiteLabelLogo(body.file_data_url);
      const path = `${tenantId}/logo.${logo.ext}`;
      const { error: uploadError } = await db.storage.from(WHITE_LABEL_LOGO_BUCKET).upload(path, logo.bytes, {
        contentType: logo.contentType,
        upsert: true,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;
      const { data: publicLogo } = db.storage.from(WHITE_LABEL_LOGO_BUCKET).getPublicUrl(path);
      const { data: tenantRow, error: tenantReadError } = await db.from("api_tenants").select("metadata").eq("id", tenantId).single();
      if (tenantReadError) throw tenantReadError;
      const metadata = tenantRow?.metadata && typeof tenantRow.metadata === "object" ? tenantRow.metadata : {};
      const oldWhiteLabel = (metadata as any).white_label && typeof (metadata as any).white_label === "object" ? (metadata as any).white_label : {};
      const { error: metadataError } = await db.from("api_tenants").update({
        metadata: { ...metadata, white_label: { ...oldWhiteLabel, enabled: true, logo_url: publicLogo.publicUrl } },
      }).eq("id", tenantId);
      if (metadataError) throw metadataError;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "white_label_logo_updated", metadata: { project_id: selectedProject?.id, tenant_id: tenantId, size_bytes: logo.bytes.byteLength } });
      return json(req, { success: true, logo_url: publicLogo.publicUrl });
    }

    if (action === "invite_team_member") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const email = clean(body.email, 254).toLowerCase();
      const role = clean(body.role, 20);
      const allowedRoles = member.role === "owner"
        ? new Set(["admin", "compliance", "developer", "viewer"])
        : new Set(["compliance", "developer", "viewer"]);
      if (!emailOk(email) || !allowedRoles.has(role)) return json(req, { success: false, error: "Valid email and permitted role required" }, 400);
      if (email === String(user.email || "").toLowerCase()) return json(req, { success: false, error: "You are already a member" }, 409);
      const { data: invitation, error: inviteRecordError } = await db.from("partner_team_invitations").insert({
        organization_id: org.id, email, role, invited_by: user.id,
      }).select("id,email,role,status,invited_at").single();
      if (inviteRecordError) return json(req, { success: false, error: "An active invitation already exists for this email" }, 409);
      const redirectTo = "https://portal.borderpayafrica.com/auth/callback?setup=password";
      const { error: emailError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (emailError) {
        await db.from("partner_team_invitations").delete().eq("id", invitation.id);
        return json(req, { success: false, error: "The invitation email could not be sent" }, 502);
      }
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "team_member_invited", metadata: { invitation_id: invitation.id, role } });
      return json(req, { success: true, invitation }, 201);
    }

    if (action === "update_team_member") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const targetUserId = clean(body.user_id, 40);
      const role = clean(body.role, 20);
      const allowedRoles = member.role === "owner"
        ? new Set(["admin", "compliance", "developer", "viewer"])
        : new Set(["compliance", "developer", "viewer"]);
      if (!targetUserId || !allowedRoles.has(role)) return json(req, { success: false, error: "Valid member and permitted role required" }, 400);
      const { data: target } = await db.from("partner_members").select("role").eq("organization_id", org.id).eq("user_id", targetUserId).maybeSingle();
      if (!target || target.role === "owner") return json(req, { success: false, error: "The organization owner role cannot be changed" }, 409);
      const { error } = await db.from("partner_members").update({ role }).eq("organization_id", org.id).eq("user_id", targetUserId);
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "team_member_role_updated", metadata: { target_user_id: targetUserId, role } });
      return json(req, { success: true });
    }

    if (action === "remove_team_member") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const targetUserId = clean(body.user_id, 40);
      if (!targetUserId || targetUserId === user.id) return json(req, { success: false, error: "You cannot remove your own access" }, 409);
      const { data: target } = await db.from("partner_members").select("role").eq("organization_id", org.id).eq("user_id", targetUserId).maybeSingle();
      if (!target || target.role === "owner") return json(req, { success: false, error: "The organization owner cannot be removed" }, 409);
      const { error } = await db.from("partner_members").update({ is_active: false }).eq("organization_id", org.id).eq("user_id", targetUserId);
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "team_member_removed", metadata: { target_user_id: targetUserId } });
      return json(req, { success: true });
    }

    if (action === "create_support_ticket") {
      const category = clean(body.category, 30);
      const subject = clean(body.subject, 160);
      const message = clean(body.message, 5000);
      if (!new Set(["integration", "compliance", "billing", "payout", "security", "other"]).has(category) || subject.length < 3 || message.length < 10) {
        return json(req, { success: false, error: "Complete the support category, subject, and message" }, 400);
      }
      const projectId = clean(body.project_id, 40) || null;
      if (projectId && !(projects || []).some((project: any) => project.id === projectId)) return json(req, { success: false, error: "Project not found" }, 404);
      const { data, error } = await db.from("partner_support_tickets").insert({
        organization_id: org.id, project_id: projectId, created_by: user.id, category, subject, message,
      }).select("id,project_id,category,subject,message,status,created_at,updated_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "support_ticket_created", metadata: { ticket_id: data.id } });
      return json(req, { success: true, ticket: data }, 201);
    }

    if (action === "create_api_key") {
      requireOperationalTenant();
      if (!canDevelop) return json(req, { success: false, error: "Developer access required" }, 403);
      const { data: tenant } = await db.from("api_tenants").select("default_mode,is_active").eq("id", tenantId).single();
      if (!tenant?.is_active) return json(req, { success: false, error: "API access is not active yet" }, 409);
      const scopes = Array.isArray(body.scopes) ? body.scopes.map((v: unknown) => clean(v, 80)).filter((v: string) => allowedScopes.has(v)) : [];
      if (!scopes.length) return json(req, { success: false, error: "Select at least one allowed scope" }, 400);
      const approval = await loadTenantApproval();
      if (approval?.status !== "approved" || !Array.isArray(approval.approved_products)) {
        return json(req, { success: false, error: "Partner product approval is required before creating keys" }, 403);
      }
      const scopeAllowed = approval.approved_products.includes("api") ||
        (approval.approved_products.includes("white_label") && scopes.every((scope: string) => scope === "onboarding:write"));
      if (!scopeAllowed) return json(req, { success: false, error: "The selected scopes exceed this project's approved products" }, 403);
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
      let endpointUrl: string;
      try { endpointUrl = validateApiWebhookEndpointUrl(clean(body.endpoint_url, 500)); }
      catch (error) { return json(req, { success: false, error: (error as Error).message }, 400); }
      const id = crypto.randomUUID();
      const version = 1;
      const secret = newApiWebhookSecret();
      const encrypted = await encryptApiWebhookSecret(secret, id, version);
      const { data, error } = await db.from("api_webhook_endpoints").insert({
        id, tenant_id: tenantId, endpoint_url: endpointUrl,
        signing_secret_hash: await sha256(secret),
        signing_secret_ciphertext: encrypted.ciphertext,
        signing_secret_nonce: encrypted.nonce,
        signing_secret_version: version,
        delivery_enabled: true,
      }).select("id,endpoint_url,is_active,delivery_enabled,event_types,created_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "webhook_created", metadata: { webhook_id: data.id } });
      return json(req, { success: true, webhook: { ...data, signing_secret: secret } }, 201);
    }

    if (action === "rotate_webhook_secret") {
      requireOperationalTenant();
      if (!canDevelop) return json(req, { success: false, error: "Developer access required" }, 403);
      const id = clean(body.webhook_id, 40);
      const { data: current, error: currentError } = await db.from("api_webhook_endpoints").select("id,signing_secret_version").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (currentError) throw currentError;
      if (!current) return json(req, { success: false, error: "Webhook endpoint not found" }, 404);
      const version = Number(current.signing_secret_version || 0) + 1;
      const secret = newApiWebhookSecret();
      const encrypted = await encryptApiWebhookSecret(secret, id, version);
      const { data, error } = await db.from("api_webhook_endpoints").update({
        signing_secret_hash: await sha256(secret),
        signing_secret_ciphertext: encrypted.ciphertext,
        signing_secret_nonce: encrypted.nonce,
        signing_secret_version: version,
        delivery_enabled: true,
      }).eq("id", id).eq("tenant_id", tenantId).select("id,endpoint_url,is_active,delivery_enabled,event_types,updated_at").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: org.id, actor_user_id: user.id, event_type: "webhook_secret_rotated", metadata: { webhook_id: id } });
      return json(req, { success: true, webhook: { ...data, signing_secret: secret } });
    }

    if (action === "disable_webhook") {
      requireOperationalTenant();
      if (!canManage) return json(req, { success: false, error: "Owner or admin access required" }, 403);
      const id = clean(body.webhook_id, 40);
      const { error } = await db.from("api_webhook_endpoints").update({ is_active: false, delivery_enabled: false }).eq("id", id).eq("tenant_id", tenantId);
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
      const missing = completeness(app, people || [], documents || [], org);
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
