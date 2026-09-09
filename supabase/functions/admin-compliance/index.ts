import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertBridgeFiatReturnPolicy } from "../_shared/bridge-fiat-return-policy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BRIDGE_API_KEY = Deno.env.get("BRIDGE_API_KEY") ?? "";
const BRIDGE_BASE_URL = (Deno.env.get("BRIDGE_BASE_URL") ?? "https://api.bridge.xyz").replace(/\/+$/, "");
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const COMPLIANCE_WORKER_TOKEN = Deno.env.get("COMPLIANCE_WORKER_TOKEN") ?? "";
const RETURNS_ENABLED = String(Deno.env.get("BRIDGE_RETURNS_ENABLED") ?? "false").toLowerCase() === "true";

const operatorEmails = Array.from(new Set(
  String(
    Deno.env.get("COMPLIANCE_OPERATOR_EMAILS")
      ?? Deno.env.get("OPERATOR_TRANSACTION_NOTIFICATION_EMAILS")
      ?? "",
  ).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
));

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

type AdminContext = { userId: string | null; role: string; email: string };
type BridgeFundsRequest = {
  id: string;
  deposit_id: string;
  customer_id: string;
  amount: string;
  currency: string;
  payment_rail: string;
  fraud: boolean;
  notice_date: string;
  imad?: string;
  trace_number?: string;
  bank_transaction_id?: string;
  created_at?: string;
  deposit_created_at?: string;
};

function normalizeRole(value: unknown): string {
  const role = String(value ?? "").trim().toUpperCase();
  if (["SUPER_ADMIN", "ADMIN_SUPER", "ADMIN_FINOPS", "SUPPORT_AGENT"].includes(role)) return role;
  if (role.includes("SUPER")) return "ADMIN_SUPER";
  if (role.includes("FINOPS") || role === "OPS") return "ADMIN_FINOPS";
  if (role.includes("SUPPORT")) return "SUPPORT_AGENT";
  if (role === "ADMIN") return "ADMIN_SUPER";
  return "";
}

async function requireAdmin(req: Request): Promise<AdminContext> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("authorization required"), { status: 401 });
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) throw Object.assign(new Error("invalid admin session"), { status: 401 });
  const { data: admin, error } = await db.from("admin_users")
    .select("user_id,email,role")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const role = normalizeRole(admin?.role);
  if (error || !admin || !role) {
    throw Object.assign(new Error("active admin access required"), { status: 403 });
  }
  return { userId: authData.user.id, role, email: String(admin.email || authData.user.email || "") };
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let different = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) different |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return different === 0;
}

function serviceContext(req: Request, action: string): AdminContext | null {
  if (action !== "sync_funds_requests") return null;
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const allowed = (COMPLIANCE_WORKER_TOKEN && timingSafeEqual(token, COMPLIANCE_WORKER_TOKEN))
    || (SERVICE_ROLE && timingSafeEqual(token, SERVICE_ROLE));
  return allowed
    ? { userId: null, role: "SYSTEM", email: "system@borderpay" }
    : null;
}

function requireRole(ctx: AdminContext, roles: string[]) {
  if (!roles.includes(ctx.role)) {
    throw Object.assign(new Error("admin role not authorized for this compliance action"), { status: 403 });
  }
}

async function audit(
  req: Request,
  ctx: AdminContext,
  action: string,
  target: string,
  beforeState: Record<string, unknown>,
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const { data, error } = await db.from("admin_action_audit").insert({
    actor_id: ctx.userId,
    role: ctx.role,
    action_type: action,
    target_resource: target,
    before_state: beforeState,
    request_id: requestId,
  }).select("id").single();
  if (error || !data?.id) throw new Error(`compliance audit write failed: ${error?.message || "unknown"}`);
  return String(data.id);
}

async function finishAudit(id: string, afterState: Record<string, unknown>) {
  const { error } = await db.from("admin_action_audit").update({ after_state: afterState }).eq("id", id);
  if (error) throw new Error(`compliance audit completion failed: ${error.message}`);
}

async function bridgeGet(path: string): Promise<unknown> {
  if (!BRIDGE_API_KEY) throw new Error("BRIDGE_API_KEY missing");
  const response = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    headers: { "Api-Key": BRIDGE_API_KEY, Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object"
      ? String((body as Record<string, unknown>).message || (body as Record<string, unknown>).error || `HTTP ${response.status}`)
      : `HTTP ${response.status}`;
    throw new Error(`Bridge ${path} failed: ${message}`);
  }
  return body;
}

async function bridgePost(path: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<unknown> {
  if (!BRIDGE_API_KEY) throw new Error("BRIDGE_API_KEY missing");
  const response = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Api-Key": BRIDGE_API_KEY,
      "Idempotency-Key": idempotencyKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object"
      ? String((body as Record<string, unknown>).message || (body as Record<string, unknown>).error || `HTTP ${response.status}`)
      : `HTTP ${response.status}`;
    throw new Error(`Bridge return transfer failed: ${message}`);
  }
  return body;
}

function fundsRequestList(raw: unknown): BridgeFundsRequest[] {
  if (!raw || typeof raw !== "object") return [];
  const rows = (raw as Record<string, unknown>).data;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is BridgeFundsRequest => {
    if (!row || typeof row !== "object") return false;
    const value = row as Record<string, unknown>;
    return Boolean(value.id && value.deposit_id && value.customer_id && value.amount && value.currency && value.payment_rail);
  });
}

async function resolveOwner(customerId: string): Promise<{
  userId: string | null;
  accountType: "individual" | "business" | null;
  linkageStatus: "linked" | "unlinked" | "ambiguous";
}> {
  const [individual, business] = await Promise.all([
    db.from("user_profiles").select("id").eq("bridge_customer_id", customerId).limit(2),
    db.from("business_profiles").select("user_id").eq("bridge_customer_id", customerId).limit(2),
  ]);
  if (individual.error) throw new Error(`individual owner lookup failed: ${individual.error.message}`);
  if (business.error) throw new Error(`business owner lookup failed: ${business.error.message}`);
  const candidates = [
    ...(individual.data || []).map((row) => ({ id: String(row.id), type: "individual" as const })),
    ...(business.data || []).map((row) => ({ id: String(row.user_id), type: "business" as const })),
  ];
  const unique = Array.from(new Map(candidates.map((candidate) => [`${candidate.id}:${candidate.type}`, candidate])).values());
  if (unique.length === 0) return { userId: null, accountType: null, linkageStatus: "unlinked" };
  if (unique.length > 1) return { userId: null, accountType: null, linkageStatus: "ambiguous" };
  return { userId: unique[0].id, accountType: unique[0].type, linkageStatus: "linked" };
}

async function sendOperatorAlert(request: BridgeFundsRequest, isNew: boolean) {
  if (!isNew || !SEND_EMAIL_TOKEN || operatorEmails.length === 0) return;
  await Promise.all(operatorEmails.map(async (recipient) => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SEND_EMAIL_TOKEN}` },
      body: JSON.stringify({
        template: "admin.incident_alert",
        to: recipient,
        idempotency_key: `bridge-funds-request:${request.id}:${recipient}`,
        props: {
          severity: request.fraud ? "critical" : "high",
          service: "bridge-funds-requests",
          title: request.fraud ? "Fraud recall received" : "Funds request received",
          currency: String(request.currency).toUpperCase(),
          code: request.fraud ? "fraud_recall" : "funds_request",
          provider_code: request.payment_rail,
          provider_request_id: request.id,
          occurred_at: request.created_at || new Date().toISOString(),
          message: `${request.amount} ${String(request.currency).toUpperCase()} · deposit ${request.deposit_id} · customer ${request.customer_id}. Review in Compliance before taking action.`,
        },
      }),
    });
    if (!response.ok) console.error(`funds-request operator email failed: ${response.status}`);
  }));
}

async function syncFundsRequests(): Promise<{ seen: number; inserted: number; linked: number; ambiguous: number }> {
  let startingAfter = "";
  let seen = 0;
  let inserted = 0;
  let linked = 0;
  let ambiguous = 0;
  for (let page = 0; page < 20; page++) {
    const earliestNoticeDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const query = new URLSearchParams({ limit: "100", notice_date_starting_on: earliestNoticeDate });
    if (startingAfter) query.set("starting_after", startingAfter);
    const rows = fundsRequestList(await bridgeGet(`/v0/funds_requests?${query.toString()}`));
    if (rows.length === 0) break;
    for (const request of rows) {
      seen += 1;
      const { data: existing, error: existingError } = await db.from("bridge_funds_requests")
        .select("provider_request_id")
        .eq("provider_request_id", request.id)
        .maybeSingle();
      if (existingError) throw new Error(`funds request lookup failed: ${existingError.message}`);
      const owner = await resolveOwner(request.customer_id);
      if (owner.linkageStatus === "linked") linked += 1;
      if (owner.linkageStatus === "ambiguous") ambiguous += 1;
      const amount = Number(request.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`invalid Bridge funds request amount for ${request.id}`);
      const { error: upsertError } = await db.from("bridge_funds_requests").upsert({
        provider_request_id: request.id,
        deposit_id: request.deposit_id,
        bridge_customer_id: request.customer_id,
        user_id: owner.userId,
        account_type: owner.accountType,
        amount: request.amount,
        currency: String(request.currency).toUpperCase(),
        payment_rail: String(request.payment_rail).toLowerCase(),
        fraud: request.fraud === true,
        notice_date: request.notice_date,
        deposit_created_at: request.deposit_created_at || null,
        provider_created_at: request.created_at || null,
        imad: request.imad || null,
        trace_number: request.trace_number || null,
        bank_transaction_id: request.bank_transaction_id || null,
        linkage_status: owner.linkageStatus,
        raw_payload: request,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "provider_request_id" });
      if (upsertError) throw new Error(`funds request upsert failed: ${upsertError.message}`);
      const isNew = !existing?.provider_request_id;
      if (isNew) inserted += 1;
      const { error: caseError } = await db.from("bridge_compliance_cases").upsert({
        funds_request_id: request.id,
        priority: request.fraud === true ? "critical" : "high",
        response_deadline: request.fraud === true
          ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
          : null,
      }, { onConflict: "funds_request_id", ignoreDuplicates: true });
      if (caseError) throw new Error(`compliance case creation failed: ${caseError.message}`);
      if (isNew) {
        const { data: alert } = await db.from("admin_alerts")
          .select("id").contains("metadata", { provider_request_id: request.id }).limit(1).maybeSingle();
        if (!alert?.id) {
          await db.from("admin_alerts").insert({
            alert_type: request.fraud ? "bridge_fraud_recall" : "bridge_funds_request",
            severity: request.fraud ? "critical" : "high",
            user_id: owner.userId,
            message: `${request.amount} ${String(request.currency).toUpperCase()} Bridge funds request requires review`,
            metadata: { provider: "bridge", provider_request_id: request.id, deposit_id: request.deposit_id },
          });
        }
      }
      await sendOperatorAlert(request, isNew);
    }
    if (rows.length < 100) break;
    startingAfter = rows[rows.length - 1].id;
  }
  return { seen, inserted, linked, ambiguous };
}

async function loadDashboard() {
  const [cases, approvals, returns, bridgeEvents, yellowCardEvents, notifications] = await Promise.all([
    db.from("bridge_compliance_cases").select("*, funds_request:bridge_funds_requests(*)")
      .order("opened_at", { ascending: false }).limit(200),
    db.from("bridge_return_approvals").select("*").order("created_at", { ascending: false }).limit(500),
    db.from("bridge_return_operations").select("*").order("requested_at", { ascending: false }).limit(200),
    db.from("bridge_webhook_events")
      .select("event_id,event_type,processing_status,target_entity_type,target_entity_id,received_at,processed_at,payload")
      .eq("signature_ok", true).order("received_at", { ascending: false }).limit(150),
    db.from("yellowcard_webhook_events")
      .select("event_fingerprint,event_name,status,provider_transaction_id,received_at,executed_at,raw_payload")
      .eq("signature_verified", true).order("received_at", { ascending: false }).limit(150),
    db.from("operator_provider_event_notifications").select("*")
      .order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [cases, approvals, returns, bridgeEvents, yellowCardEvents, notifications]) {
    if (result.error) throw new Error(`compliance dashboard query failed: ${result.error.message}`);
  }
  const approvalsByCase = new Map<string, unknown[]>();
  for (const approval of approvals.data || []) {
    const key = String(approval.case_id);
    approvalsByCase.set(key, [...(approvalsByCase.get(key) || []), approval]);
  }
  const returnByCase = new Map((returns.data || []).map((row) => [String(row.case_id), row]));
  const rows = (cases.data || []).map((row) => ({
    ...row,
    approvals: approvalsByCase.get(String(row.id)) || [],
    return_operation: returnByCase.get(String(row.id)) || null,
  }));
  const recentEvents = [
    ...(bridgeEvents.data || []),
    ...(yellowCardEvents.data || []).map((event) => ({
      event_id: event.event_fingerprint,
      event_type: event.event_name,
      processing_status: "completed",
      target_entity_type: "yellow_card_transaction",
      target_entity_id: event.provider_transaction_id,
      received_at: event.received_at,
      processed_at: event.executed_at,
      payload: event.raw_payload,
    })),
  ].sort((a, b) => Date.parse(String(b.received_at)) - Date.parse(String(a.received_at))).slice(0, 200);
  return {
    cases: rows,
    recent_events: recentEvents,
    notification_deliveries: notifications.data || [],
    returns_enabled: RETURNS_ENABLED,
    operator_email_configured: operatorEmails.length > 0,
    funds_request_transport: "polling",
  };
}

function validStatus(value: string): boolean {
  return [
    "open", "investigating", "awaiting_customer", "awaiting_bridge", "return_proposed",
    "return_approved", "return_submitted", "return_completed", "return_failed", "closed_no_return",
  ].includes(value);
}

async function authoritativeCustomerFrozen(userId: unknown): Promise<boolean> {
  const id = String(userId || "");
  if (!id) return false;
  const { data, error } = await db.from("user_profiles")
    .select("account_status,account_frozen_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`authoritative customer restriction lookup failed: ${error.message}`);
  return String(data?.account_status || "").toLowerCase() === "frozen" && Boolean(data?.account_frozen_at);
}

async function updateCase(ctx: AdminContext, body: Record<string, unknown>) {
  requireRole(ctx, ["ADMIN_SUPER", "SUPER_ADMIN", "ADMIN_FINOPS"]);
  const caseId = String(body.case_id || "");
  const status = String(body.status || "");
  if (!caseId || !validStatus(status)) throw Object.assign(new Error("valid case_id and status required"), { status: 400 });
  const evidence = Array.isArray(body.evidence_references) ? body.evidence_references : [];
  const notes = String(body.investigation_notes || "").trim();
  const { data: current, error: currentError } = await db.from("bridge_compliance_cases")
    .select("id,funds_request:bridge_funds_requests(user_id)").eq("id", caseId).maybeSingle();
  if (currentError || !current) throw Object.assign(new Error("compliance case not found"), { status: 404 });
  const currentFundsRequest = current.funds_request as { user_id?: string | null } | null;
  const customerFrozen = await authoritativeCustomerFrozen(currentFundsRequest?.user_id);
  const { data, error } = await db.from("bridge_compliance_cases").update({
    status,
    customer_frozen: customerFrozen,
    customer_contacted: body.customer_contacted === true,
    evidence_complete: body.evidence_complete === true,
    evidence_references: evidence,
    investigation_notes: notes || null,
    updated_at: new Date().toISOString(),
    closed_at: status === "closed_no_return" || status === "return_completed" ? new Date().toISOString() : null,
    closed_by: status === "closed_no_return" || status === "return_completed" ? ctx.userId : null,
  }).eq("id", caseId).select("*").single();
  if (error) throw new Error(`case update failed: ${error.message}`);
  return data;
}

async function approveCase(ctx: AdminContext, body: Record<string, unknown>) {
  requireRole(ctx, ["ADMIN_SUPER", "SUPER_ADMIN", "ADMIN_FINOPS"]);
  const caseId = String(body.case_id || "");
  const decision = String(body.decision || "");
  const rationale = String(body.rationale || "").trim();
  if (!caseId || !["approve", "reject"].includes(decision) || rationale.length < 10) {
    throw Object.assign(new Error("case_id, approve/reject decision, and a 10-character rationale are required"), { status: 400 });
  }
  const { data: caseRow, error: caseError } = await db.from("bridge_compliance_cases")
    .select("id,evidence_complete,customer_frozen,status,funds_request:bridge_funds_requests(user_id)").eq("id", caseId).maybeSingle();
  if (caseError || !caseRow) throw Object.assign(new Error("compliance case not found"), { status: 404 });
  const approvalFundsRequest = caseRow.funds_request as { user_id?: string | null } | null;
  const customerFrozen = await authoritativeCustomerFrozen(approvalFundsRequest?.user_id);
  await db.from("bridge_compliance_cases").update({ customer_frozen: customerFrozen, updated_at: new Date().toISOString() }).eq("id", caseId);
  if (decision === "approve" && (!caseRow.evidence_complete || !customerFrozen)) {
    throw Object.assign(new Error("return approval requires complete evidence and a frozen customer"), { status: 409 });
  }
  const { data, error } = await db.from("bridge_return_approvals").upsert({
    case_id: caseId,
    actor_id: ctx.userId,
    actor_role: ctx.role,
    decision,
    rationale,
  }, { onConflict: "case_id,actor_id" }).select("*").single();
  if (error) throw new Error(`return approval failed: ${error.message}`);
  const { data: approvals } = await db.from("bridge_return_approvals")
    .select("decision").eq("case_id", caseId);
  const approved = (approvals || []).filter((row) => row.decision === "approve").length;
  const rejected = (approvals || []).some((row) => row.decision === "reject");
  if (approved >= 2 && !rejected) {
    await db.from("bridge_compliance_cases").update({
      status: "return_approved",
      updated_at: new Date().toISOString(),
    }).eq("id", caseId);
  }
  return { approval: data, approval_count: approved, rejected };
}

async function liveFundsRequest(expected: Record<string, unknown>): Promise<BridgeFundsRequest> {
  const customerId = String(expected.bridge_customer_id || "");
  const raw = await bridgeGet(`/v0/funds_requests?customer_id=${encodeURIComponent(customerId)}&limit=100`);
  const match = fundsRequestList(raw).find((row) => row.id === expected.provider_request_id);
  if (!match) throw new Error("live Bridge funds request no longer matches the local case");
  const comparisons: Array<[unknown, unknown, string]> = [
    [match.deposit_id, expected.deposit_id, "deposit_id"],
    [match.customer_id, expected.bridge_customer_id, "customer_id"],
    [String(match.currency).toUpperCase(), String(expected.currency).toUpperCase(), "currency"],
    [String(match.payment_rail).toLowerCase(), String(expected.payment_rail).toLowerCase(), "payment_rail"],
    [Number(match.amount), Number(expected.amount), "amount"],
  ];
  for (const [actual, stored, field] of comparisons) {
    if (actual !== stored) throw new Error(`live Bridge funds request ${field} changed; manual reconciliation required`);
  }
  return match;
}

async function executeReturn(ctx: AdminContext, body: Record<string, unknown>) {
  requireRole(ctx, ["ADMIN_SUPER", "SUPER_ADMIN"]);
  if (!RETURNS_ENABLED) throw Object.assign(new Error("Bridge returns are disabled by BRIDGE_RETURNS_ENABLED"), { status: 423 });
  const caseId = String(body.case_id || "");
  const sourceWalletId = String(body.source_bridge_wallet_id || "").trim();
  const sourceCurrency = String(body.source_currency || "").trim().toLowerCase();
  const requestedAmount = Number(body.amount);
  if (!caseId || !sourceWalletId || !["usdc", "usdb"].includes(sourceCurrency) || !Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw Object.assign(new Error("valid case, Bridge wallet, USDC/USDB source, and positive amount are required"), { status: 400 });
  }
  const { data: caseRow, error } = await db.from("bridge_compliance_cases")
    .select("*, funds_request:bridge_funds_requests(*)").eq("id", caseId).maybeSingle();
  if (error || !caseRow) throw Object.assign(new Error("compliance case not found"), { status: 404 });
  const fundsRequest = caseRow.funds_request as Record<string, unknown>;
  const customerFrozen = await authoritativeCustomerFrozen(fundsRequest.user_id);
  if (caseRow.status !== "return_approved" || !customerFrozen || !caseRow.evidence_complete) {
    throw Object.assign(new Error("case is not eligible for return execution"), { status: 409 });
  }
  const { data: operatorAccount, error: operatorLookupError } = await db.from("operator_bridge_accounts")
    .select("bridge_customer_id")
    .eq("bridge_customer_id", String(fundsRequest.bridge_customer_id || ""))
    .eq("active", true)
    .maybeSingle();
  if (operatorLookupError) throw new Error(`operator account exclusion lookup failed: ${operatorLookupError.message}`);
  if (operatorAccount?.bridge_customer_id) {
    throw Object.assign(new Error("operator Bridge accounts are not eligible for customer return operations"), { status: 409 });
  }
  const { data: approvals, error: approvalsError } = await db.from("bridge_return_approvals")
    .select("actor_id,decision").eq("case_id", caseId);
  if (approvalsError) throw new Error(`approval lookup failed: ${approvalsError.message}`);
  const approvedActors = new Set((approvals || []).filter((row) => row.decision === "approve").map((row) => row.actor_id));
  const rejected = (approvals || []).some((row) => row.decision === "reject");
  if (approvedActors.size < 2 || rejected) throw Object.assign(new Error("two distinct approvals and no rejection are required"), { status: 409 });
  const live = await liveFundsRequest(fundsRequest);
  let policy;
  try {
    policy = assertBridgeFiatReturnPolicy({
      requestedAmount,
      originalAmount: live.amount,
      destinationCurrency: live.currency,
      sourceCurrency,
      paymentRail: live.payment_rail,
      depositCreatedAt: String(live.deposit_created_at || ""),
    });
  } catch (policyError) {
    throw Object.assign(policyError as Error, { status: 409 });
  }
  const destinationCurrency = policy.destinationCurrency;
  if (String(body.confirmation || "").trim() !== policy.confirmation) {
    throw Object.assign(new Error(`confirmation must exactly match: ${policy.confirmation}`), { status: 400 });
  }
  const idempotencyKey = `bp-return:${caseId}`;
  const payload = {
    amount: policy.amount,
    on_behalf_of: live.customer_id,
    source: {
      payment_rail: "bridge_wallet",
      currency: policy.sourceCurrency,
      bridge_wallet_id: sourceWalletId,
    },
    destination: {
      payment_rail: "fiat_deposit_return",
      currency: destinationCurrency,
      deposit_id: live.deposit_id,
    },
  };
  const { data: existing } = await db.from("bridge_return_operations").select("*").eq("case_id", caseId).maybeSingle();
  if (existing && ["submitted", "pending", "completed", "returned"].includes(String(existing.status))) {
    throw Object.assign(new Error("a return has already been submitted for this case"), { status: 409 });
  }
  if (existing && JSON.stringify(existing.request_payload) !== JSON.stringify(payload)) {
    throw Object.assign(new Error("retry payload differs from the prepared idempotent return"), { status: 409 });
  }
  if (!existing) {
    const { error: prepareError } = await db.from("bridge_return_operations").insert({
      case_id: caseId,
      idempotency_key: idempotencyKey,
      bridge_customer_id: live.customer_id,
      deposit_id: live.deposit_id,
      amount: requestedAmount,
      destination_currency: destinationCurrency.toUpperCase(),
      source_currency: policy.sourceCurrency.toUpperCase(),
      source_bridge_wallet_id: sourceWalletId,
      request_payload: payload,
      requested_by: ctx.userId,
    });
    if (prepareError) throw new Error(`return preparation failed: ${prepareError.message}`);
  }
  try {
    const response = await bridgePost("/v0/transfers", payload, idempotencyKey);
    const responseRecord = response && typeof response === "object" ? response as Record<string, unknown> : {};
    const bridgeTransferId = String(responseRecord.id || responseRecord.transfer_id || "");
    if (!bridgeTransferId) throw new Error("Bridge accepted the request without a transfer identifier");
    const { error: updateError } = await db.from("bridge_return_operations").update({
      bridge_transfer_id: bridgeTransferId,
      status: "submitted",
      response_payload: responseRecord,
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("case_id", caseId);
    if (updateError) throw new Error(`return projection update failed: ${updateError.message}`);
    await db.from("bridge_compliance_cases").update({ status: "return_submitted", updated_at: new Date().toISOString() }).eq("id", caseId);
    return { bridge_transfer_id: bridgeTransferId, status: "submitted", idempotency_key: idempotencyKey };
  } catch (executionError) {
    await db.from("bridge_return_operations").update({
      error_message: (executionError as Error).message,
      updated_at: new Date().toISOString(),
    }).eq("case_id", caseId);
    throw executionError;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "invalid JSON" }, 400);
  }
  let auditId = "";
  try {
    const action = String(body.action || "dashboard");
    const ctx = serviceContext(req, action) ?? await requireAdmin(req);
    auditId = await audit(req, ctx, action, String(body.case_id || "bridge-compliance"), {
      ...body,
      confirmation: body.confirmation ? "[REDACTED]" : undefined,
    });
    let data: unknown;
    if (action === "dashboard") data = await loadDashboard();
    else if (action === "sync_funds_requests") {
      requireRole(ctx, ["ADMIN_SUPER", "SUPER_ADMIN", "ADMIN_FINOPS", "SYSTEM"]);
      data = await syncFundsRequests();
    } else if (action === "update_case") data = await updateCase(ctx, body);
    else if (action === "approve_return") data = await approveCase(ctx, body);
    else if (action === "execute_return") data = await executeReturn(ctx, body);
    else throw Object.assign(new Error("unsupported compliance action"), { status: 400 });
    await finishAudit(auditId, { success: true, action });
    return json({ success: true, data });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (auditId) await finishAudit(auditId, { success: false, error: err.message }).catch(() => undefined);
    return json({ success: false, error: err.message || "admin compliance failed" }, err.status || 500);
  }
});
