import { deliverPartnerDecisionEmail } from "../_shared/partner-decision-email.ts";
import { createPartnerAccessLink } from "../_shared/partner-access-invite.ts";
import { resendPartnerInvitation } from "../_shared/partner-invite-resend.ts";
import { checkPartnerLegalIdentity } from "../_shared/partner-legal-identity.ts";
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
const normalizeEmail = (value: unknown) => clean(value, 254).toLowerCase();
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const ilikeLiteral = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const FLUTTERWAVE_SECRET_KEY = Deno.env.get("FLUTTERWAVE_SECRET_KEY") || "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") || "";

const sha256 = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const createFlutterwaveInvoiceLink = async (input: {
  organizationId: string; invoiceNumber: string; amount: number; recipient: string; partnerName: string;
}) => {
  if (!FLUTTERWAVE_SECRET_KEY) throw new Error("Flutterwave invoice collection is not configured");
  const digest = await sha256(`${input.organizationId}:${input.invoiceNumber.trim().toLowerCase()}`);
  const reference = `bp-partner-invoice-${digest.slice(0, 32)}`;
  const response = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: { "Authorization": `Bearer ${FLUTTERWAVE_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: reference,
      amount: input.amount.toFixed(2),
      currency: "USD",
      redirect_url: "https://portal.borderpayafrica.com/?billing=invoice",
      customer: { email: input.recipient, name: input.partnerName },
      customizations: { title: "BorderPay partner invoice", description: `Invoice ${input.invoiceNumber}` },
      meta: { borderpay_partner_organization_id: input.organizationId, borderpay_partner_invoice_number: input.invoiceNumber },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const paymentUrl = clean(payload?.data?.link, 1000);
  if (!response.ok || clean(payload?.status).toLowerCase() !== "success" || !paymentUrl.startsWith("https://")) {
    throw new Error(`Flutterwave payment link failed (${response.status})`);
  }
  return { reference, paymentUrl };
};

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
  let inviteStage = "initializing invitation";
  const deliverPartnerAccessInvite = async (email: string, requestId: number) => {
    if (!SEND_EMAIL_TOKEN) throw new Error("Partner invitation email is not configured");
    const access = await createPartnerAccessLink(db, email, url);
    const sendResponse = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SEND_EMAIL_TOKEN}` },
      body: JSON.stringify({
        template: "partner.access_invite",
        to: email,
        user_id: access.userId,
        idempotency_key: `partner-access-invite:${requestId}:${crypto.randomUUID()}`,
        props: { existing_account: access.existingAccount },
        sensitive_props: { invite_url: access.actionLink },
      }),
    });
    const sendResult = await sendResponse.json().catch(() => ({}));
    const deliveryStatus = clean(sendResult?.data?.status, 40).toLowerCase();
    if (!sendResponse.ok || sendResult?.success !== true || deliveryStatus !== "sent") {
      throw new Error(clean(sendResult?.error, 300) || `Partner invitation delivery failed (${sendResponse.status})`);
    }
    return { access, sendResult };
  };
  const sendPartnerInvoiceEmail = async (invoice: any, recipient: string, partnerName: string, idempotencyKey: string) => {
    const internalToken = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") || "";
    if (!internalToken) return { sent: false, error: "Email dispatcher is not configured" };
    const response = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${internalToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        template: "business.partner_invoice", to: recipient,
        idempotency_key: idempotencyKey,
        props: {
          partner_name: partnerName, invoice_number: invoice.invoice_number,
          period_start: invoice.period_start, period_end: invoice.period_end,
          due_at: invoice.due_at, total: Number(invoice.total || 0).toFixed(2),
          currency: invoice.currency || "USD", payment_method: invoice.payment_method,
          payment_url: invoice.payment_url || "https://portal.borderpayafrica.com",
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    const deliveryStatus = String(result?.data?.status || "").toLowerCase();
    return response.ok && result?.success && deliveryStatus !== "failed"
      ? { sent: true, result }
      : { sent: false, error: result?.error || `Email HTTP ${response.status}` };
  };
  try {
    if (action === "list_invite_requests") {
      const { data, error } = await db.from("partner_access_invite_requests")
        .select("id,email,status,requested_at,approved_at,invited_at,accepted_at")
        .order("requested_at", { ascending: false }).limit(250);
      if (error) throw error;
      return json(req, { success: true, requests: data || [] });
    }

    if (action === "resend_invite") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      inviteStage = "resending the partner invitation";
      const result = await resendPartnerInvitation(db, Number(body?.request_id), deliverPartnerAccessInvite);
      if (result.status === 200) console.info("partner_invite_resent", { request_id: Number(body?.request_id), operator_id: authData.user.id });
      return json(req, result.body, result.status);
    }

    if (action === "send_direct_invite") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      const email = normalizeEmail(body?.email);
      if (!validEmail(email)) return json(req, { success: false, error: "Enter a valid business email address" }, 400);
      const emailPattern = ilikeLiteral(email);

      inviteStage = "checking existing partner access";
      const { data: organization, error: organizationError } = await db.from("partner_organizations")
        .select("id,status").ilike("primary_email", emailPattern).limit(1).maybeSingle();
      if (organizationError) throw organizationError;
      if (organization) return json(req, { success: false, error: "This email already belongs to a partner organization" }, 409);

      inviteStage = "checking existing invitation";
      const { data: existing, error: existingError } = await db.from("partner_access_invite_requests")
        .select("id,email,status,requested_at,invited_at,accepted_at")
        .ilike("email", emailPattern).order("requested_at", { ascending: false }).limit(1).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.status === "accepted") return json(req, { success: false, error: "This invitation has already been accepted" }, 409);
      if (existing?.status === "invited") return json(req, { success: false, error: "An active invitation already exists. Use Resend invite in Access requests." }, 409);

      let requestId = Number(existing?.id || 0);
      const requestedAt = new Date().toISOString();
      inviteStage = requestId ? "resetting the pending invitation" : "creating the pending invitation";
      if (requestId) {
        const { error } = await db.from("partner_access_invite_requests").update({
          email, status: "pending", approved_by: null, approved_at: null,
          invited_at: null, accepted_at: null, requested_at: requestedAt,
        }).eq("id", requestId);
        if (error) throw error;
      } else {
        const { data: created, error } = await db.from("partner_access_invite_requests")
          .insert({ email, status: "pending", requested_at: requestedAt })
          .select("id").single();
        if (error) throw error;
        requestId = Number(created.id);
      }

      inviteStage = "creating and delivering the secure access link";
      let delivery;
      try {
        delivery = await deliverPartnerAccessInvite(email, requestId);
      } catch (sendError) {
        console.error("partner_direct_invite_delivery_failed", { request_id: requestId, email, message: String((sendError as Error)?.message || sendError) });
        return json(req, { success: false, error: "Invitation delivery failed. The request remains pending and can be retried." }, 502);
      }

      const now = new Date().toISOString();
      inviteStage = "recording successful delivery";
      const { data: invitation, error: updateError } = await db.from("partner_access_invite_requests")
        .update({ status: "invited", approved_by: authData.user.id, approved_at: now, invited_at: now })
        .eq("id", requestId)
        .select("id,email,status,requested_at,approved_at,invited_at,accepted_at").maybeSingle();
      if (updateError) throw updateError;
      if (!invitation) throw new Error("Invitation row was not available after delivery");
      console.info("partner_direct_invite_sent", { request_id: requestId, email, operator_id: authData.user.id });
      return json(req, {
        success: true,
        invitation,
        existing_account: delivery.access.existingAccount,
        delivery_provider: delivery.sendResult?.data?.provider || null,
      });
    }

    if (action === "approve_invite") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      const requestId = Number(body?.request_id);
      if (!Number.isInteger(requestId) || requestId <= 0) return json(req, { success: false, error: "request_id required" }, 400);
      inviteStage = "loading the pending invitation";
      const { data: invite, error: inviteError } = await db.from("partner_access_invite_requests")
        .select("id,email,status").eq("id", requestId).single();
      if (inviteError || !invite) return json(req, { success: false, error: "Invite request not found" }, 404);
      if (invite.status !== "pending") return json(req, { success: false, error: "Invite request is no longer pending" }, 409);
      inviteStage = "creating and delivering the secure access link";
      let delivery;
      try {
        delivery = await deliverPartnerAccessInvite(invite.email, requestId);
      } catch (sendError) {
        console.error("partner_invite_delivery_failed", { request_id: requestId, email: invite.email, message: String((sendError as Error)?.message || sendError) });
        return json(req, { success: false, error: "Invitation delivery failed. The request remains pending and can be retried." }, 502);
      }
      const now = new Date().toISOString();
      inviteStage = "recording successful delivery";
      const { data: updated, error } = await db.from("partner_access_invite_requests")
        .update({ status: "invited", approved_by: authData.user.id, approved_at: now, invited_at: now })
        .eq("id", requestId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error("Invitation row was not available after delivery");
      return json(req, {
        success: true,
        status: "invited",
        existing_account: delivery.access.existingAccount,
        delivery_provider: delivery.sendResult?.data?.provider || null,
      });
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

    if (action === "partner_finance_overview") {
      const [{ data: organizations, error: orgError }, { data: projects, error: projectError }, { data: terms, error: termsError }, { data: invoices, error: invoiceError }, { data: providerInvoices, error: providerInvoiceError }, { data: allocations, error: allocationError }, { data: payouts, error: payoutError }] = await Promise.all([
        db.from("partner_organizations").select("id,legal_name,trading_name,primary_email,status,partner_model,commercial_status,approved_tenant_id").order("legal_name"),
        db.from("partner_projects").select("id,organization_id,tenant_id,name,environment,status").not("tenant_id", "is", null),
        db.from("partner_commercial_terms").select("id,organization_id,partner_model,volume_tier,currency,upfront_fee,monthly_fee,va_onramp_percent,external_fiat_offramp_percent,crypto_to_crypto_percent,african_rails_markup_percent,partner_developer_fee_percent,effective_from,effective_until,nda_reference,treasury_agreement_reference,is_active").eq("is_active", true),
        db.from("partner_invoices").select("id,organization_id,invoice_number,period_start,period_end,issued_at,due_at,currency,subtotal,tax,total,amount_paid,status,payment_method,payment_reference,payment_url,sent_at,paid_at,partner_invoice_line_items(id,line_type,description,provider,product,quantity,unit_amount,amount,allocation_basis)").order("period_end", { ascending: false }).limit(500),
        db.from("partner_provider_invoices").select("id,provider,provider_invoice_number,period_start,period_end,currency,total,source_document_path,status,created_at").order("period_end", { ascending: false }).limit(250),
        db.from("partner_provider_cost_allocations").select("id,provider_invoice_id,organization_id,partner_invoice_line_item_id,allocation_key,quantity,allocated_amount,evidence,created_at").order("created_at", { ascending: false }).limit(2000),
        db.from("partner_developer_fee_ledger").select("id,organization_id,tenant_id,provider,provider_transaction_id,currency,gross_partner_fee,reversal_amount,payable_amount,state,occurred_at,paid_at,payout_reference").order("occurred_at", { ascending: false }).limit(5000),
      ]);
      for (const error of [orgError, projectError, termsError, invoiceError, providerInvoiceError, allocationError, payoutError]) if (error) throw error;
      const tenantIds = (projects || []).map((row: any) => row.tenant_id).filter(Boolean);
      let resources: any[] = [];
      if (tenantIds.length) {
        const { data, error } = await db.from("api_tenant_provider_resources")
          .select("id,tenant_id,tenant_end_user_id,provider,resource_type,provider_resource_id,provider_status,metadata,created_at,updated_at")
          .in("tenant_id", tenantIds).in("resource_type", ["deposit", "transfer"])
          .order("created_at", { ascending: false }).limit(5000);
        if (error) throw error;
        resources = data || [];
      }
      const projectByTenant = new Map((projects || []).map((row: any) => [row.tenant_id, row]));
      const orgById = new Map((organizations || []).map((row: any) => [row.id, row]));
      const transactions = resources.map((resource: any) => {
        const project: any = projectByTenant.get(resource.tenant_id) || null;
        const organization: any = project ? orgById.get(project.organization_id) : null;
        const metadata = resource.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
        return {
          ...resource,
          state: resource.provider_status || metadata.status || null,
          amount: metadata.amount || metadata.source_amount || metadata.destination_amount || null,
          source_currency: metadata.currency || metadata.source_currency || null,
          destination_currency: metadata.destination_currency || null,
          display_name: metadata.display_name || null,
          external_reference: metadata.external_reference || null,
          organization_id: organization?.id || null,
          partner_name: organization?.trading_name || organization?.legal_name || null,
          partner_email: organization?.primary_email || null,
          partner_model: organization?.partner_model || null,
          project_id: project?.id || null,
          project_name: project?.name || null,
          environment: project?.environment || null,
        };
      });
      return json(req, {
        success: true,
        organizations: organizations || [], projects: projects || [], terms: terms || [],
        invoices: invoices || [], provider_invoices: providerInvoices || [], provider_cost_allocations: allocations || [],
        developer_fee_ledger: payouts || [], transactions,
      });
    }

    if (action === "import_provider_invoice") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "IMPORT PROVIDER INVOICE") return json(req, { success: false, error: "Type IMPORT PROVIDER INVOICE to confirm" }, 400);
      const provider = clean(body.provider, 80).toLowerCase();
      const providerInvoiceNumber = clean(body.provider_invoice_number, 120);
      const total = Number(body.total);
      if (!provider || !providerInvoiceNumber || !Number.isFinite(total) || total < 0) return json(req, { success: false, error: "Provider, invoice number, and non-negative total are required" }, 400);
      const { data, error } = await db.from("partner_provider_invoices").insert({
        provider, provider_invoice_number: providerInvoiceNumber,
        period_start: clean(body.period_start, 20), period_end: clean(body.period_end, 20),
        currency: clean(body.currency, 12).toUpperCase() || "USD", total,
        source_document_path: clean(body.source_document_path, 1000) || null,
        status: "imported", imported_by: authData.user.id,
      }).select("*").single();
      if (error) throw error;
      return json(req, { success: true, provider_invoice: data }, 201);
    }

    if (action === "allocate_provider_cost") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "ALLOCATE PROVIDER COST") return json(req, { success: false, error: "Type ALLOCATE PROVIDER COST to confirm" }, 400);
      const providerInvoiceId = clean(body.provider_invoice_id, 40);
      const organizationId = clean(body.organization_id, 40);
      const tenantId = clean(body.tenant_id, 40);
      const allocationKey = clean(body.allocation_key, 200);
      const resourceIds = Array.isArray(body.provider_resource_ids) ? [...new Set(body.provider_resource_ids.map((value: unknown) => clean(value, 200)).filter(Boolean))] : [];
      const quantity = Number(body.quantity);
      const allocatedAmount = Number(body.allocated_amount);
      if (!providerInvoiceId || !organizationId || !tenantId || !allocationKey || !resourceIds.length || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(allocatedAmount) || allocatedAmount < 0) {
        return json(req, { success: false, error: "Complete the provider invoice, partner tenant, allocation, amount, and evidence" }, 400);
      }
      const { data: project } = await db.from("partner_projects").select("id").eq("organization_id", organizationId).eq("tenant_id", tenantId).maybeSingle();
      if (!project) return json(req, { success: false, error: "Tenant does not belong to the selected partner" }, 409);
      const { data: ownedResources, error: resourceError } = await db.from("api_tenant_provider_resources")
        .select("provider_resource_id").eq("tenant_id", tenantId).in("provider_resource_id", resourceIds);
      if (resourceError) throw resourceError;
      if ((ownedResources || []).length !== resourceIds.length) return json(req, { success: false, error: "Every allocation evidence ID must be owned by the selected partner tenant" }, 409);
      const { data, error } = await db.rpc("admin_allocate_partner_provider_cost", {
        p_provider_invoice_id: providerInvoiceId, p_organization_id: organizationId,
        p_allocation_key: allocationKey, p_quantity: quantity, p_allocated_amount: allocatedAmount,
        p_evidence: { tenant_id: tenantId, provider_resource_ids: resourceIds, operator_note: clean(body.operator_note, 1000) || null },
      });
      if (error) throw error;
      return json(req, { success: true, allocation: data }, 201);
    }

    const applicationId = clean(body?.application_id, 40);
    if (!applicationId) return json(req, { success: false, error: "application_id required" }, 400);
    const { data: application, error: appError } = await db.from("partner_applications").select("*,partner_organizations(*)").eq("id", applicationId).single();
    if (appError || !application) return json(req, { success: false, error: "Application not found" }, 404);

    if (action === "set_commercial_terms") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "SET PARTNER TERMS") return json(req, { success: false, error: "Type SET PARTNER TERMS to confirm" }, 400);
      const requestedProducts = Array.isArray(application.requested_products)
        ? [...new Set(application.requested_products.filter((value: unknown) => value === "api" || value === "white_label"))]
        : [];
      if (requestedProducts.length !== 1) return json(req, { success: false, error: "Partner application must contain exactly one approved model" }, 409);
      const partnerModel = requestedProducts[0];
      const volumeTier = clean(body.volume_tier, 30);
      if (!new Set(["standard", "high_volume"]).has(volumeTier)) return json(req, { success: false, error: "Volume tier is invalid" }, 400);
      const expected = partnerModel === "api"
        ? { upfront: 0, monthly: 0, onramp: volumeTier === "high_volume" ? 1.5 : 2 }
        : { upfront: volumeTier === "high_volume" ? 10000 : 5000, monthly: volumeTier === "high_volume" ? 1500 : 750, onramp: volumeTier === "high_volume" ? 1.5 : 2 };
      const developerFee = Number(body.partner_developer_fee_percent ?? 0);
      if (!Number.isFinite(developerFee) || developerFee < 0 || developerFee > 100) return json(req, { success: false, error: "Partner developer-fee share must be between 0 and 100" }, 400);
      const ndaReference = clean(body.nda_reference, 500);
      const treasuryReference = clean(body.treasury_agreement_reference, 500);
      if (!ndaReference || !treasuryReference) return json(req, { success: false, error: "Signed NDA and Treasury Agreement references are both required" }, 400);
      const { data, error } = await db.rpc("admin_set_partner_commercial_terms", {
        p_organization_id: application.organization_id,
        p_partner_model: partnerModel,
        p_volume_tier: volumeTier,
        p_upfront_fee: expected.upfront,
        p_monthly_fee: expected.monthly,
        p_va_onramp_percent: expected.onramp,
        p_external_fiat_offramp_percent: 1,
        p_crypto_to_crypto_percent: 0,
        p_african_rails_markup_percent: 1,
        p_partner_developer_fee_percent: developerFee,
        p_effective_from: body.effective_from || new Date().toISOString(),
        p_nda_reference: ndaReference,
        p_treasury_agreement_reference: treasuryReference,
        p_approved_by: authData.user.id,
      });
      if (error) throw error;
      await db.from("partner_portal_audit_log").insert({ organization_id: application.organization_id, application_id: applicationId, actor_user_id: authData.user.id, event_type: "commercial_terms_activated", metadata: { partner_model: partnerModel, volume_tier: volumeTier, partner_developer_fee_percent: developerFee } });
      return json(req, { success: true, terms: data });
    }

    if (action === "create_partner_invoice") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "ISSUE PARTNER INVOICE") return json(req, { success: false, error: "Type ISSUE PARTNER INVOICE to confirm" }, 400);
      const invoiceNumber = clean(body.invoice_number, 80);
      const lines = Array.isArray(body.lines) ? body.lines : [];
      const allowedLineTypes = new Set(["upfront_fee", "monthly_fee", "provider_usage", "transaction_fee", "email_usage", "adjustment"]);
      if (!invoiceNumber || !lines.length || lines.length > 100) return json(req, { success: false, error: "Invoice number and 1–100 line items are required" }, 400);
      const normalizedLines = lines.map((line: any) => ({
        line_type: clean(line?.line_type, 40), description: clean(line?.description, 500),
        provider: clean(line?.provider, 80) || null, product: clean(line?.product, 120) || null,
        quantity: Number(line?.quantity), unit_amount: Number(line?.unit_amount),
        allocation_basis: clean(line?.allocation_basis, 500) || null,
        evidence: line?.evidence && typeof line.evidence === "object" && !Array.isArray(line.evidence) ? line.evidence : {},
      }));
      if (normalizedLines.some((line: any) => !allowedLineTypes.has(line.line_type) || !line.description || !Number.isFinite(line.quantity) || line.quantity < 0 || !Number.isFinite(line.unit_amount) || line.unit_amount < 0)) {
        return json(req, { success: false, error: "One or more invoice lines are invalid" }, 400);
      }
      if (normalizedLines.some((line: any) => line.line_type === "provider_usage" && (!line.provider || !line.allocation_basis || !clean(line.evidence?.allocation_id, 40)))) {
        return json(req, { success: false, error: "Provider usage lines require provider, allocation basis, and a reviewed allocation ID" }, 400);
      }
      const paymentMethod = clean(body.payment_method, 30);
      if (!new Set(["bank_transfer", "flutterwave"]).has(paymentMethod)) return json(req, { success: false, error: "Payment method is invalid" }, 400);
      const partnerName = application.partner_organizations?.trading_name || application.partner_organizations?.legal_name || "Partner";
      const recipient = clean(application.partner_organizations?.primary_email, 254).toLowerCase();
      if (!validEmail(recipient)) return json(req, { success: false, error: "Partner billing email is invalid" }, 409);
      const { data: duplicateInvoice, error: duplicateError } = await db.from("partner_invoices")
        .select("id").eq("invoice_number", invoiceNumber).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicateInvoice) return json(req, { success: false, error: "Invoice number already exists" }, 409);

      let paymentReference = clean(body.payment_reference, 200) || null;
      let paymentUrl = clean(body.payment_url, 1000);
      if (paymentUrl) {
        try { if (new URL(paymentUrl).protocol !== "https:") throw new Error(); }
        catch { return json(req, { success: false, error: "Payment URL must use HTTPS" }, 400); }
      }
      if (paymentMethod === "flutterwave") {
        const invoiceTotal = normalizedLines.reduce((sum: number, line: any) => sum + line.quantity * line.unit_amount, 0);
        if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) return json(req, { success: false, error: "Flutterwave invoice total must be greater than zero" }, 400);
        try {
          const providerInvoice = await createFlutterwaveInvoiceLink({
            organizationId: application.organization_id, invoiceNumber, amount: invoiceTotal, recipient, partnerName,
          });
          paymentReference = providerInvoice.reference;
          paymentUrl = providerInvoice.paymentUrl;
        } catch (error) {
          console.error("partner_invoice_payment_link_failed", { organization_id: application.organization_id, invoice_number: invoiceNumber, error: error instanceof Error ? error.message : String(error) });
          return json(req, { success: false, error: "Flutterwave payment link could not be created. No invoice was issued." }, 502);
        }
      }
      const { data, error } = await db.rpc("admin_create_partner_invoice", {
        p_organization_id: application.organization_id,
        p_invoice_number: invoiceNumber,
        p_period_start: clean(body.period_start, 20), p_period_end: clean(body.period_end, 20),
        p_due_at: body.due_at, p_payment_method: paymentMethod,
        p_payment_reference: paymentReference,
        p_payment_url: paymentUrl || null,
        p_lines: normalizedLines, p_created_by: authData.user.id,
      });
      if (error) throw error;
      const delivery = await sendPartnerInvoiceEmail(data, recipient, partnerName, `partner-invoice:${data.id}:issued`);
      if (delivery.sent) await db.from("partner_invoices").update({ sent_at: new Date().toISOString() }).eq("id", data.id).eq("organization_id", application.organization_id);
      await db.from("partner_portal_audit_log").insert({ organization_id: application.organization_id, application_id: applicationId, actor_user_id: authData.user.id, event_type: "partner_invoice_issued", metadata: { invoice_id: data?.id, invoice_number: invoiceNumber } });
      return json(req, { success: true, invoice: data, email_sent: delivery.sent, email_error: delivery.sent ? null : delivery.error });
    }

    if (action === "send_partner_invoice") {
      if (!canOperate) return json(req, { success: false, error: "Super admin access required" }, 403);
      if (clean(body.confirmation, 40) !== "RESEND PARTNER INVOICE") return json(req, { success: false, error: "Type RESEND PARTNER INVOICE to confirm" }, 400);
      const invoiceId = clean(body.invoice_id, 40);
      const { data: invoice, error } = await db.from("partner_invoices").select("*").eq("id", invoiceId).eq("organization_id", application.organization_id).single();
      if (error || !invoice) return json(req, { success: false, error: "Partner invoice not found" }, 404);
      if (invoice.status === "void") return json(req, { success: false, error: "A void invoice cannot be sent" }, 409);
      const partnerName = application.partner_organizations?.trading_name || application.partner_organizations?.legal_name || "Partner";
      const recipient = clean(application.partner_organizations?.primary_email, 254).toLowerCase();
      const delivery = await sendPartnerInvoiceEmail(invoice, recipient, partnerName, `partner-invoice:${invoice.id}:manual:${crypto.randomUUID()}`);
      if (!delivery.sent) return json(req, { success: false, error: delivery.error || "Invoice email failed" }, 502);
      await db.from("partner_invoices").update({ sent_at: new Date().toISOString() }).eq("id", invoice.id);
      return json(req, { success: true, email_sent: true });
    }

    if (action === "get") {
      const tenantId = clean(application.partner_organizations?.approved_tenant_id, 40);
      const [{ data: people }, { data: documents }, { data: reviews }, { data: pricing }, { data: tenant }, { data: approval }, { data: commercialTerms }, { data: invoices }] = await Promise.all([
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
        db.from("partner_commercial_terms").select("*").eq("organization_id", application.organization_id).eq("is_active", true).maybeSingle(),
        db.from("partner_invoices").select("*,partner_invoice_line_items(*)").eq("organization_id", application.organization_id).order("period_end", { ascending: false }).limit(36),
      ]);
      return json(req, { success: true, application, people: people || [], documents: documents || [], reviews: reviews || [], pricing: pricing || [], tenant, approval, commercial_terms: commercialTerms || null, invoices: invoices || [] });
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
      const identity = checkPartnerLegalIdentity(entity, business);
      const checks = identity.checks;
      if (!identity.ok) {
        return json(req, { success: false, error: identity.error, code: identity.code, fields: identity.fields, checks }, 409);
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
      const { data: saved, error: decisionError } = await db.rpc("record_partner_application_decision", {
        p_application_id: applicationId, p_actor_user_id: authData.user.id, p_decision: decision, p_notes: notes,
      });
      if (decisionError) throw decisionError;
      if (!saved?.review_id) throw new Error("Decision could not be recorded");
      const email = await deliverPartnerDecisionEmail(saved, { url, token: SEND_EMAIL_TOKEN });
      const { error: auditError } = await db.from("partner_portal_audit_log").insert({
        organization_id: saved.organization_id, application_id: applicationId, actor_user_id: authData.user.id,
        event_type: "partner_decision_email_" + email.status,
        metadata: { review_id: saved.review_id, email_log_id: email.log_id ?? null, error: email.error ?? null },
      });
      if (auditError) console.error("partner_decision_email_audit_failed", { review_id: saved.review_id });
      return json(req, { success: true, status: decision, review_id: saved.review_id, tenant_id: saved.tenant_id, production_access: false, email });
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
      if (requestedProducts.length !== 1) return json(req, { success: false, error: "Select exactly one partner model before sandbox activation" }, 409);
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
      // Activation is deliberately last. A failed approval or project write
      // must leave the API tenant disabled rather than partially operational.
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
    const diagnosticCode = clean((error as { code?: unknown })?.code, 40) || "runtime_error";
    console.error("partner-application-admin", {
      action,
      invite_stage: action === "send_direct_invite" || action === "approve_invite" || action === "resend_invite" ? inviteStage : null,
      code: diagnosticCode,
      message: clean((error as { message?: unknown })?.message || error, 500),
    });
    if (action === "send_direct_invite" || action === "approve_invite" || action === "resend_invite") {
      return json(req, {
        success: false,
        error: `Partner invitation failed while ${inviteStage}. Reference: ${diagnosticCode}`,
        code: "partner_invite_runtime_error",
      }, 500);
    }
    return json(req, { success: false, error: "Partner administration request failed" }, 500);
  }
});
