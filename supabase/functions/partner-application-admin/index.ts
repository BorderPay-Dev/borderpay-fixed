import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ADMIN_ORIGINS = new Set([
  "https://admin.borderpayafrica.com",
  "https://portal.borderpayafrica.com",
  "https://partners.borderpayafrica.com",
  "https://borderpay-partners.vercel.app",
  "http://localhost:5173",
]);
const allowedOrigin = (origin: string | null) => {
  if (!origin) return "https://admin.borderpayafrica.com";
  if (ADMIN_ORIGINS.has(origin) || /^https:\/\/borderpay-partners-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return "https://admin.borderpayafrica.com";
};
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
});
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const clean = (value: unknown, max = 2000) => String(value ?? "").trim().slice(0, max);
const comparable = (value: unknown) => clean(value, 300).toLowerCase().replace(/[^a-z0-9]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.headers.get("origin") && allowedOrigin(req.headers.get("origin")) !== req.headers.get("origin")) return json(req, { success: false, error: "Origin not allowed" }, 403);
  if (req.method !== "POST") return json(req, { success: false, error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return json(req, { success: false, error: "Server configuration missing" }, 500);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return json(req, { success: false, error: "Authentication required" }, 401);
  const { data: admin } = await db.from("admin_users").select("user_id,role").eq("user_id", authData.user.id).maybeSingle();
  if (!admin) return json(req, { success: false, error: "Admin access required" }, 403);
  const adminRole = clean(admin.role, 80).toUpperCase();
  const canOperate = adminRole === "ADMIN_SUPER" || adminRole === "SUPER_ADMIN" || adminRole === "ADMIN";

  let body: any;
  try { body = await req.json(); } catch { return json(req, { success: false, error: "Invalid JSON" }, 400); }
  const action = clean(body?.action, 60);
  try {
    if (action === "list_invite_requests") {
      const { data, error } = await db.from("partner_access_invite_requests")
        .select("id,email,status,requested_at,approved_at,invited_at,accepted_at")
        .order("requested_at", { ascending: false }).limit(250);
      if (error) throw error;
      return json(req, { success: true, requests: data || [] });
    }

    if (action === "approve_invite") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      const requestId = Number(body?.request_id);
      if (!Number.isInteger(requestId) || requestId <= 0) return json(req, { success: false, error: "request_id required" }, 400);
      const { data: invite, error: inviteError } = await db.from("partner_access_invite_requests")
        .select("id,email,status").eq("id", requestId).single();
      if (inviteError || !invite) return json(req, { success: false, error: "Invite request not found" }, 404);
      if (invite.status !== "pending") return json(req, { success: false, error: "Invite request is no longer pending" }, 409);
      const redirectTo = "https://portal.borderpayafrica.com/auth/callback?setup=password";
      const { error: sendError } = await db.auth.admin.inviteUserByEmail(invite.email, { redirectTo });
      if (sendError) throw sendError;
      const now = new Date().toISOString();
      const { error } = await db.from("partner_access_invite_requests").update({ status: "invited", approved_by: authData.user.id, approved_at: now, invited_at: now }).eq("id", requestId).eq("status", "pending");
      if (error) throw error;
      return json(req, { success: true, status: "invited" });
    }

    if (action === "reject_invite") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      const requestId = Number(body?.request_id);
      if (!Number.isInteger(requestId) || requestId <= 0) return json(req, { success: false, error: "request_id required" }, 400);
      const { error } = await db.from("partner_access_invite_requests").update({ status: "rejected", approved_by: authData.user.id, approved_at: new Date().toISOString() }).eq("id", requestId).eq("status", "pending");
      if (error) throw error;
      return json(req, { success: true, status: "rejected" });
    }

    if (action === "list") {
      const { data, error } = await db.from("partner_applications").select("id,organization_id,version,status,requested_products,submitted_at,created_at,updated_at,partner_organizations!inner(legal_name,trading_name,primary_email,country_of_incorporation,status)").order("created_at", { ascending: false }).limit(250);
      if (error) throw error;
      return json(req, { success: true, applications: data || [] });
    }
    const applicationId = clean(body?.application_id, 40);
    if (!applicationId) return json(req, { success: false, error: "application_id required" }, 400);
    const { data: application, error: appError } = await db.from("partner_applications").select("*,partner_organizations(*)").eq("id", applicationId).single();
    if (appError || !application) return json(req, { success: false, error: "Application not found" }, 404);

    if (action === "get") {
      const tenantId = clean(application.partner_organizations?.approved_tenant_id, 40);
      const [{ data: people }, { data: documents }, { data: reviews }, { data: pricing }, { data: tenant }, { data: approval }] = await Promise.all([
        db.from("partner_controlling_people").select("*").eq("application_id", applicationId).order("created_at"),
        db.from("partner_application_documents").select("id,document_type,original_filename,mime_type,size_bytes,storage_path,created_at").eq("application_id", applicationId).order("created_at"),
        db.from("partner_application_reviews").select("*").eq("application_id", applicationId).order("created_at", { ascending: false }),
        db.from("partner_pricing_rules").select("*").eq("organization_id", application.organization_id).order("effective_from", { ascending: false }),
        tenantId
          ? db.from("api_tenants").select("id,tenant_name,default_mode,is_active,beta_access_enabled,rate_limit_per_minute,max_single_transfer_usd,metadata,created_at,updated_at").eq("id", tenantId).maybeSingle()
          : Promise.resolve({ data: null }),
        tenantId
          ? db.from("api_partner_approvals").select("status,approved_products,approved_use_case,approved_at,suspended_at,suspension_reason").eq("tenant_id", tenantId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return json(req, { success: true, application, people: people || [], documents: documents || [], reviews: reviews || [], pricing: pricing || [], tenant, approval });
    }

    if (action === "document_download") {
      const { data: document, error } = await db.from("partner_application_documents").select("storage_path").eq("id", clean(body.document_id, 40)).eq("application_id", applicationId).single();
      if (error || !document) return json(req, { success: false, error: "Document not found" }, 404);
      const { data: signed, error: signError } = await db.storage.from("partner-due-diligence").createSignedUrl(document.storage_path, 300);
      if (signError) throw signError;
      return json(req, { success: true, signed_url: signed.signedUrl, expires_in: 300 });
    }

    if (action === "verify_bridge_kyb") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "VERIFY BRIDGE KYB") {
        return json(req, { success: false, error: "Type VERIFY BRIDGE KYB to confirm" }, 400);
      }
      const bridgeCustomerId = clean(body.bridge_customer_id, 120);
      if (!bridgeCustomerId) return json(req, { success: false, error: "Bridge business customer ID required" }, 400);
      const { data: businesses, error: businessError } = await db.from("business_profiles")
        .select("user_id,company_name,registration_number,country,status,bridge_customer_id,bridge_kyb_status")
        .eq("bridge_customer_id", bridgeCustomerId).limit(2);
      if (businessError) throw businessError;
      if ((businesses || []).length !== 1) return json(req, { success: false, error: "Bridge customer must map to exactly one BorderPay business" }, 409);
      const business: any = businesses![0];
      if (business.status !== "active" || !["approved", "active"].includes(clean(business.bridge_kyb_status, 40).toLowerCase())) {
        return json(req, { success: false, error: "Bridge business KYB is not approved and active" }, 409);
      }
      const entity = application.entity_details || {};
      const checks = {
        legal_name: comparable(entity.legal_name) === comparable(business.company_name),
        registration_number: comparable(entity.registration_number) === comparable(business.registration_number),
        country: clean(entity.country_of_incorporation, 2).toUpperCase() === clean(business.country, 2).toUpperCase(),
      };
      if (!checks.legal_name || !checks.registration_number || !checks.country) {
        return json(req, { success: false, error: "Partner legal identity does not exactly match the verified Bridge business", checks }, 409);
      }
      const now = new Date().toISOString();
      const { error: updateError } = await db.from("partner_organizations").update({
        kyb_source: "bridge_verified", bridge_customer_id: bridgeCustomerId,
        bridge_verified_at: now, bridge_verified_by: authData.user.id, updated_at: now,
      }).eq("id", application.organization_id);
      if (updateError) throw updateError;
      await db.from("partner_portal_audit_log").insert({
        organization_id: application.organization_id, application_id: applicationId,
        actor_user_id: authData.user.id, event_type: "bridge_business_kyb_verified",
        metadata: { bridge_customer_id: bridgeCustomerId, identity_checks: checks },
      });
      return json(req, { success: true, kyb_source: "bridge_verified", bridge_customer_id: bridgeCustomerId, identity_checks: checks });
    }

    if (action === "decision") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      const decision = clean(body.decision, 40);
      if (!["under_review", "more_information", "approved", "rejected", "suspended"].includes(decision)) return json(req, { success: false, error: "Invalid decision" }, 400);
      const notes = clean(body.notes, 4000);
      if (!notes) return json(req, { success: false, error: "Review notes required" }, 400);
      const now = new Date().toISOString();
      let tenantId = application.partner_organizations?.approved_tenant_id || null;
      if (decision === "approved" && !tenantId) {
        const { data: tenant, error: tenantError } = await db.from("api_tenants").insert({
          tenant_name: application.partner_organizations?.legal_name || application.partner_organizations?.primary_email,
          default_mode: "sandbox",
          is_active: false,
          beta_access_enabled: false,
          metadata: { partner_organization_id: application.organization_id, provisioning_status: "operator_required", pricing_source: "partner_custom_only" },
        }).select("id").single();
        if (tenantError) throw tenantError;
        tenantId = tenant.id;
      }
      const orgStatus = decision === "more_information" ? "more_information" : decision;
      const { error: updateError } = await db.from("partner_applications").update({ status: decision, decision_summary: notes, decided_at: ["approved", "rejected"].includes(decision) ? now : null, updated_at: now }).eq("id", applicationId);
      if (updateError) throw updateError;
      await db.from("partner_organizations").update({ status: orgStatus, approved_tenant_id: tenantId, updated_at: now }).eq("id", application.organization_id);
      await db.from("partner_application_reviews").insert({ application_id: applicationId, reviewer_user_id: authData.user.id, decision, notes });
      await db.from("partner_portal_audit_log").insert({ organization_id: application.organization_id, application_id: applicationId, actor_user_id: authData.user.id, event_type: `application_${decision}`, metadata: { tenant_id: tenantId } });
      return json(req, { success: true, status: decision, tenant_id: tenantId, production_access: false });
    }

    if (action === "activate_sandbox") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "ACTIVATE SANDBOX") {
        return json(req, { success: false, error: "Type ACTIVATE SANDBOX to confirm" }, 400);
      }
      if (application.status !== "approved" || application.partner_organizations?.status !== "approved") {
        return json(req, { success: false, error: "Approve partner KYB before sandbox activation" }, 409);
      }
      const tenantId = clean(application.partner_organizations?.approved_tenant_id, 40);
      if (!tenantId) return json(req, { success: false, error: "Approved sandbox tenant is missing" }, 409);
      const now = new Date().toISOString();
      const requestedProducts: string[] = Array.isArray(application.requested_products)
        ? [...new Set<string>(application.requested_products.map((value: unknown) => clean(value, 30)))]
          .filter((value) => value === "api" || value === "white_label")
        : [];
      if (!requestedProducts.length) return json(req, { success: false, error: "No approved partner product was selected" }, 409);
      const technical = application.technical_details || {};
      const operating = application.operating_details || {};
      const technicalEmail = clean(technical.technical_contact_email, 254).toLowerCase();
      const complianceEmail = clean(technical.compliance_contact_email, 254).toLowerCase();
      const incidentEmail = clean(technical.security_contact_email, 254).toLowerCase();
      if (![technicalEmail, complianceEmail, incidentEmail].every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return json(req, { success: false, error: "Valid technical, compliance, and security contacts are required before sandbox activation" }, 409);
      }
      const { data: currentApproval, error: currentApprovalError } = await db.from("api_partner_approvals")
        .select("status").eq("tenant_id", tenantId).maybeSingle();
      if (currentApprovalError) throw currentApprovalError;
      if (currentApproval && currentApproval.status !== "approved") {
        return json(req, { success: false, error: "A suspended or rejected partner approval cannot be reactivated from this workflow" }, 409);
      }
      const actor = clean(authData.user.email || authData.user.id, 254);
      const { error: approvalError } = await db.from("api_partner_approvals").upsert({
        tenant_id: tenantId,
        status: "approved",
        partner_type: "platform",
        approved_products: requestedProducts,
        approved_use_case: clean(operating.intended_use || operating.business_model, 2000),
        technical_contact_email: technicalEmail,
        compliance_contact_email: complianceEmail,
        incident_contact_email: incidentEmail,
        compliance_approval_reference: `partner-application:${applicationId}`,
        engineering_approval_reference: `sandbox-activation:${applicationId}`,
        compliance_approved_by: actor,
        engineering_approved_by: actor,
        recorded_by: actor,
        approved_at: now,
        suspended_at: null,
        suspended_by: null,
        suspension_reason: null,
      }, { onConflict: "tenant_id" });
      if (approvalError) throw approvalError;
      const { data: existingTenant, error: tenantReadError } = await db.from("api_tenants")
        .select("metadata").eq("id", tenantId).single();
      if (tenantReadError) throw tenantReadError;
      const metadata = existingTenant?.metadata && typeof existingTenant.metadata === "object"
        ? existingTenant.metadata
        : {};
      const { data: tenant, error: tenantError } = await db.from("api_tenants")
        .update({
          default_mode: "sandbox",
          is_active: true,
          beta_access_enabled: true,
          metadata: { ...metadata, provisioning_status: "sandbox_active", production_access: false },
          updated_at: now,
        })
        .eq("id", tenantId)
        .select("id,tenant_name,default_mode,is_active,beta_access_enabled,rate_limit_per_minute,max_single_transfer_usd")
        .single();
      if (tenantError) throw tenantError;
      const { data: existingProject, error: projectReadError } = await db.from("partner_projects")
        .select("id").eq("organization_id", application.organization_id).eq("slug", "primary").maybeSingle();
      if (projectReadError) throw projectReadError;
      if (existingProject) {
        const { error: projectUpdateError } = await db.from("partner_projects")
          .update({ tenant_id: tenantId, environment: "sandbox", status: "active", updated_at: now })
          .eq("id", existingProject.id);
        if (projectUpdateError) throw projectUpdateError;
      } else {
        const { error: projectInsertError } = await db.from("partner_projects").insert({
          organization_id: application.organization_id,
          tenant_id: tenantId,
          name: application.partner_organizations?.trading_name || application.partner_organizations?.legal_name || "Primary project",
          slug: "primary",
          environment: "sandbox",
          status: "active",
          created_by: application.partner_organizations?.owner_user_id,
        });
        if (projectInsertError) throw projectInsertError;
      }
      await db.from("partner_portal_audit_log").insert({
        organization_id: application.organization_id,
        application_id: applicationId,
        actor_user_id: authData.user.id,
        event_type: "sandbox_activated",
        metadata: { tenant_id: tenantId, approved_products: requestedProducts, production_access: false },
      });
      return json(req, { success: true, tenant, approved_products: requestedProducts, production_access: false });
    }

    if (action === "set_pricing") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (application.partner_organizations?.status !== "approved") return json(req, { success: false, error: "Approve partner before pricing" }, 409);
      const rule = body?.rule || {};
      const payload = {
        organization_id: application.organization_id,
        provider: clean(rule.provider, 30), product: clean(rule.product, 60),
        source_currency: clean(rule.source_currency, 12).toUpperCase() || null,
        destination_currency: clean(rule.destination_currency, 12).toUpperCase() || null,
        fee_type: clean(rule.fee_type, 40), fee_percent: rule.fee_percent == null ? null : Number(rule.fee_percent),
        fixed_amount: rule.fixed_amount == null ? null : Number(rule.fixed_amount), fixed_currency: clean(rule.fixed_currency, 12).toUpperCase() || null,
        effective_from: rule.effective_from || new Date().toISOString(), effective_until: rule.effective_until || null,
        approved_by: authData.user.id, approval_reference: clean(rule.approval_reference, 500), is_active: rule.is_active !== false,
      };
      if (!payload.approval_reference) return json(req, { success: false, error: "Pricing approval reference required" }, 400);
      if (!new Set(["bridge", "yellow_card", "borderpay"]).has(payload.provider)) return json(req, { success: false, error: "Approved provider required" }, 400);
      if (!new Set(["virtual_account_onramp", "external_fiat_offramp", "crypto_transfer", "african_rails"]).has(payload.product)) return json(req, { success: false, error: "Approved pricing product required" }, 400);
      if (!new Set(["percent", "fixed"]).has(payload.fee_type)) return json(req, { success: false, error: "Fee type must be percent or fixed" }, 400);
      if (payload.fee_type === "percent" && (!Number.isFinite(payload.fee_percent) || Number(payload.fee_percent) < 0 || Number(payload.fee_percent) > 100)) {
        return json(req, { success: false, error: "Percent fee must be between 0 and 100" }, 400);
      }
      if (payload.fee_type === "fixed" && (!Number.isFinite(payload.fixed_amount) || Number(payload.fixed_amount) < 0 || !payload.fixed_currency)) {
        return json(req, { success: false, error: "Fixed fee requires a non-negative amount and currency" }, 400);
      }
      const { data, error } = await db.from("partner_pricing_rules").insert(payload).select("*").single();
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: application.organization_id, application_id: applicationId, actor_user_id: authData.user.id, event_type: "partner_pricing_created", metadata: { pricing_rule_id: data.id } });
      return json(req, { success: true, rule: data });
    }
    return json(req, { success: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("partner-application-admin", error);
    return json(req, { success: false, error: "Partner administration request failed" }, 500);
  }
});
