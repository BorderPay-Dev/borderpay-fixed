import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  knowledgeSources,
  renderSupportKnowledge,
  retrieveSupportKnowledge,
  SUPPORT_KNOWLEDGE_VERSION,
  type SupportKnowledgeEntry,
} from "../_shared/support-knowledge-base.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Action =
  | "create_ticket"
  | "public_create_ticket"
  | "list_tickets"
  | "get_ticket"
  | "add_message"
  | "support_health"
  | "brevo_ingest";

const STATUSES = new Set(["open", "pending_support", "pending_user", "resolved", "closed"]);
const ISSUE_TYPES = new Set(["account_access", "verification", "wallet_balances", "send_receive", "general"]);
const HIGH_PRIORITY_ISSUES = new Set(["account_access", "verification", "wallet_balances", "send_receive"]);
const SUPPORT_OPERATOR_EMAIL = "markikaba@borderpayafrica.com";

function trimText(v: unknown, max = 1000): string {
  return String(v || "").trim().slice(0, max);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function derivePriority(issueType: string): "normal" | "high" {
  return HIGH_PRIORITY_ISSUES.has(issueType) ? "high" : "normal";
}

function priorityRank(value: unknown): number {
  const v = String(value || "").toLowerCase();
  if (v === "urgent") return 3;
  if (v === "high") return 2;
  if (v === "normal") return 1;
  return 0;
}

function firstString(...values: Array<unknown>): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function extractAiText(payload: any): string {
  const direct = String(payload?.output_text ?? payload?.choices?.[0]?.message?.content ?? "").trim();
  if (direct) return direct;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const value = String(part?.text ?? part?.value ?? "").trim();
      if (value) return value;
    }
  }
  return "";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type EscalationDecision = {
  escalate: boolean;
  reasons: string[];
};

function shouldForceHumanHandoff(input: {
  issueType: string;
  subject: string;
  conversation: Array<{ sender_type: string; body: string }>;
}): EscalationDecision {
  const reasons: string[] = [];
  const issue = String(input.issueType || "").toLowerCase();
  const text = [
    input.subject || "",
    ...input.conversation.map((m) => m?.body || ""),
  ].join("\n").toLowerCase();

  // Issue-type hard gates.
  if (issue === "wallet_balances") reasons.push("wallet_balance_incident");
  if (issue === "verification") reasons.push("verification_incident");
  if (issue === "send_receive") reasons.push("money_movement_incident");
  if (issue === "account_access") reasons.push("account_access_incident");

  // Content hard gates for fintech risk.
  const highRiskMatchers: Array<[RegExp, string]> = [
    [/\b(stuck|pending|failed|declined|reversed|missing)\b.*\b(transfer|withdraw|payout|send|deposit|payment)\b/, "payment_state_dispute"],
    [/\b(double charge|charged twice|duplicate charge|unauthori[sz]ed|fraud|scam)\b/, "fraud_or_charge_dispute"],
    [/\b(kyc|kyb|verify|verification)\b.*\b(rejected|failed|blocked|stuck|unable)\b/, "verification_failure"],
    [/\b(can't login|cannot login|locked out|account locked|reset password not working)\b/, "account_lockout"],
    [/\b(balance wrong|wallet missing|funds missing|money missing|cannot see funds)\b/, "funds_visibility_incident"],
    [/\b(my|our)\b.*\b(account|wallet|transaction|transfer|payment|payout|deposit|balance|verification)\b.*\b(blocked|disabled|failed|frozen|missing|paused|pending|rejected|stuck|wrong)\b/, "account_specific_request"],
    [/\b(why|check|review|investigate)\b.*\b(my|our)\b.*\b(account|wallet|transaction|transfer|payment|payout|deposit|balance|verification)\b/, "account_specific_request"],
    [/\b(transaction|transfer|payment|payout|deposit)\s*(id|reference|number)\s*[:#-]?\s*[a-z0-9-]{8,}\b/, "transaction_reference_supplied"],
    [/\b(is|are|will)\b.*\b(my|our)\b.*\b(company|business|account)\b.*\b(eligible|approved|accepted|restricted)\b/, "customer_specific_eligibility"],
    [/\b(ignore|reveal|repeat|override)\b.*\b(instruction|prompt|policy|system message|secret)\b/, "prompt_injection_attempt"],
    [/\b(lawsuit|legal|regulator|compliance complaint|report to)\b/, "legal_or_regulatory_risk"],
  ];

  for (const [re, reason] of highRiskMatchers) {
    if (re.test(text)) reasons.push(reason);
  }

  return { escalate: reasons.length > 0, reasons };
}

async function generateSupportDraft(input: {
  ticketSubject: string;
  issueType: string;
  conversation: Array<{ sender_type: string; body: string; created_at?: string }>;
  operatorGuidance?: string;
  knowledge: SupportKnowledgeEntry[];
}): Promise<{ draft: string; provider: "azure_openai" | "openai"; model: string }> {
  const supportAiEnabled = (Deno.env.get("SUPPORT_AI_ENABLED") ?? "true").toLowerCase() === "true";
  if (!supportAiEnabled) {
    throw new Error("AI support drafting is disabled");
  }

  const systemPrompt = [
    "You are BorderPay customer support assistant for a live fintech product.",
    "Write a concise, human reply to the customer.",
    "Use only the APPROVED BORDERPAY KNOWLEDGE supplied below. Do not use outside knowledge.",
    "Do not mention infrastructure providers or internal implementation details.",
    "Do not change, estimate, reinterpret or combine fees, eligibility rules, product availability or compliance requirements.",
    "Never state or infer a customer's balance, transaction status, verification outcome, or account state.",
    "Never promise approval, account activation, a deadline, a refund or completion of money movement.",
    "Do not promise money movement completion unless already confirmed in the conversation.",
    "If the supplied knowledge cannot answer the question, return exactly HANDOFF_REQUIRED.",
    "Keep tone professional and calm.",
  ].join(" ");

  const convoLines = input.conversation
    .slice(-12)
    .map((m) => `[${m.sender_type}] ${String(m.body || "").trim()}`)
    .join("\n");

  const userPrompt = [
    `Ticket subject: ${input.ticketSubject}`,
    `Issue type: ${input.issueType}`,
    input.operatorGuidance ? `Operator guidance: ${input.operatorGuidance}` : "",
    `Knowledge version: ${SUPPORT_KNOWLEDGE_VERSION}`,
    "APPROVED BORDERPAY KNOWLEDGE:",
    renderSupportKnowledge(input.knowledge),
    "Recent conversation:",
    convoLines || "(no prior messages)",
    "",
    "Return only the final customer-facing reply text.",
  ].filter(Boolean).join("\n");

  const azureEndpoint = (Deno.env.get("AZURE_OPENAI_ENDPOINT") ?? "").trim();
  const azureKey = (Deno.env.get("AZURE_OPENAI_API_KEY") ?? "").trim();
  const azureDeployment = (
    Deno.env.get("AZURE_OPENAI_DEPLOYMENT_NAME")
    ?? Deno.env.get("AZURE_OPENAI_DEPLOYMENT")
    ?? ""
  ).trim();
  const supportModel = (Deno.env.get("SUPPORT_AI_MODEL") ?? "").trim();
  const azureApiVersion = (Deno.env.get("AZURE_OPENAI_API_VERSION") ?? "2024-10-21").trim();
  const openaiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const openaiModel = (Deno.env.get("OPENAI_MODEL") ?? "gpt-4o").trim();

  let azureFailureReason = "";
  if (azureEndpoint && azureKey && (azureDeployment || supportModel)) {
    const deployments = [...new Set([supportModel, azureDeployment].filter(Boolean))];
    for (const deployment of deployments) try {
      const base = azureEndpoint.replace(/\/+$/, "");
      const useV1Responses =
        /\/openai\/v1$/i.test(base) ||
        (Deno.env.get("AZURE_OPENAI_API_STYLE") ?? "").toLowerCase() === "responses";

      if (useV1Responses) {
        const res = await fetchWithTimeout(`${base}/responses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": azureKey,
          },
          body: JSON.stringify({
            model: deployment,
            input: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = typeof raw?.error?.message === "string" ? raw.error.message : `Azure OpenAI error (${res.status})`;
          throw new Error(errMsg);
        }
        const outText = extractAiText(raw);
        if (!outText) throw new Error("Azure OpenAI returned an empty draft");
        return { draft: outText, provider: "azure_openai", model: deployment };
      } else {
        const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": azureKey,
          },
          body: JSON.stringify({
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
        const raw = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = typeof raw?.error?.message === "string" ? raw.error.message : `Azure OpenAI error (${res.status})`;
          throw new Error(errMsg);
        }
        const draft = extractAiText(raw);
        if (!draft) throw new Error("Azure OpenAI returned an empty draft");
        return { draft, provider: "azure_openai", model: deployment };
      }
    } catch (e: any) {
      azureFailureReason = String(e?.message || "Azure OpenAI request failed");
    }
  }

  if (openaiKey) {
    const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: openaiModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = typeof raw?.error?.message === "string" ? raw.error.message : `OpenAI error (${res.status})`;
      throw new Error(errMsg);
    }
    const draft = String(raw?.choices?.[0]?.message?.content ?? "").trim();
    if (!draft) throw new Error("OpenAI returned an empty draft");
    return { draft, provider: "openai", model: openaiModel };
  }

  if (azureFailureReason) {
    throw new Error(`Azure OpenAI failed and no OpenAI fallback configured: ${azureFailureReason}`);
  }
  throw new Error("AI provider not configured");
}

function supportHealthSnapshot() {
  const supportAiEnabled = (Deno.env.get("SUPPORT_AI_ENABLED") ?? "true").toLowerCase() === "true";
  const azureEndpoint = (Deno.env.get("AZURE_OPENAI_ENDPOINT") ?? "").trim();
  const azureKey = (Deno.env.get("AZURE_OPENAI_API_KEY") ?? "").trim();
  const azureDeployment = (
    Deno.env.get("AZURE_OPENAI_DEPLOYMENT_NAME")
    ?? Deno.env.get("AZURE_OPENAI_DEPLOYMENT")
    ?? ""
  ).trim();
  const openaiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  const openaiModel = (Deno.env.get("OPENAI_MODEL") ?? "gpt-4o").trim();

  const azureConfigured = Boolean(azureEndpoint && azureKey && azureDeployment);
  const openaiConfigured = Boolean(openaiKey);

  let provider: "azure_openai" | "openai" | "none" = "none";
  let model = "";
  if (azureConfigured) {
    provider = "azure_openai";
    model = azureDeployment;
  } else if (openaiConfigured) {
    provider = "openai";
    model = openaiModel;
  }

  return {
    timestamp: new Date().toISOString(),
    ai_enabled: supportAiEnabled,
    knowledge_version: SUPPORT_KNOWLEDGE_VERSION,
    provider,
    model,
    ready: supportAiEnabled && provider !== "none",
    checks: {
      azure_configured: azureConfigured,
      openai_configured: openaiConfigured,
    },
  };
}

function ticketReference(ticketId: string): string {
  return `BP-${String(ticketId || "").replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function humanHandoffReply(reference: string): string {
  return [
    `Your inquiry has been forwarded to a human support specialist. Your ticket number is ${reference}.`,
    "Please allow up to 2 hours for a response and do not open another ticket for the same issue.",
    "You can continue this conversation here.",
  ].join(" ");
}

function groundedFallback(
  reference: string,
  entries: SupportKnowledgeEntry[],
): string {
  const answers = entries.slice(0, 2).map((entry) => entry.answer);
  const sources = knowledgeSources(entries);
  return [
    ...answers,
    sources.length ? `More information: ${sources.join(" · ")}` : "",
    `Ticket number: ${reference}`,
  ].filter(Boolean).join("\n\n");
}

function groundedReply(
  draft: string,
  reference: string,
  entries: SupportKnowledgeEntry[],
): string {
  const sources = knowledgeSources(entries);
  return [
    draft.trim(),
    sources.length ? `More information: ${sources.join(" · ")}` : "",
    `Ticket number: ${reference}`,
  ].filter(Boolean).join("\n\n");
}

function validateGroundedDraft(
  draft: string,
  entries: SupportKnowledgeEntry[],
): boolean {
  const normalized = draft.trim();
  if (!normalized || normalized.length > 1800) return false;
  if (/\b(guaranteed|guarantee approval|definitely approved|we approved your|your balance is|your transaction is)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(bridge\.xyz|yellow card|flutterwave|brevo|supabase|azure openai|openai)\b/i.test(normalized)) {
    return false;
  }
  const approvedText = entries.map((entry) => entry.answer).join(" ");
  const approvedNumbers = new Set(approvedText.match(/\b\d+(?:\.\d+)?%?\b/g) || []);
  const draftNumbers = normalized.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
  if (!draftNumbers.every((value) => approvedNumbers.has(value))) return false;
  const allowedUrls = new Set(knowledgeSources(entries));
  const draftUrls = normalized.match(/https?:\/\/[^\s)]+/gi) || [];
  return draftUrls.every((value) => allowedUrls.has(value.replace(/[.,;]+$/, "")));
}

async function sendOperatorHandoffEmail(input: {
  ticketId: string;
  requesterEmail: string;
  requesterName?: string | null;
  issueType: string;
  subject: string;
  message: string;
  reasons: string[];
  userMessageNumber: number;
}): Promise<{ sent: boolean; error?: string }> {
  const internalToken = (Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  if (!internalToken || !supabaseUrl) return { sent: false, error: "email_gateway_not_configured" };

  const reference = ticketReference(input.ticketId);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${internalToken}`,
      },
      body: JSON.stringify({
        template: "admin.support_handoff",
        to: SUPPORT_OPERATOR_EMAIL,
        idempotency_key: `support-handoff:${input.ticketId}:${input.userMessageNumber}`,
        reply_to: input.requesterEmail || undefined,
        props: {
          ticket_number: reference,
          ticket_id: input.ticketId,
          requester_email: input.requesterEmail,
          requester_name: input.requesterName || "Customer",
          issue_type: input.issueType,
          subject: input.subject,
          message: input.message,
          reasons: input.reasons,
          user_message_number: input.userMessageNumber,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !(payload as any)?.success) {
      return { sent: false, error: String((payload as any)?.error || `send-email HTTP ${response.status}`) };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, error: String((error as Error)?.message || "operator_email_failed") };
  }
}

async function automateFirstResponse(input: {
  ticket: any;
  message: string;
  requesterName?: string | null;
}): Promise<void> {
  const reference = ticketReference(input.ticket.id);
  const conversation = [{ sender_type: "user", body: input.message }];
  const escalation = shouldForceHumanHandoff({
    issueType: String(input.ticket.issue_type || "general"),
    subject: String(input.ticket.subject || ""),
    conversation,
  });
  const knowledge = retrieveSupportKnowledge([
    String(input.ticket.subject || ""),
    input.message,
  ].join("\n"));
  if (!escalation.escalate && knowledge.length === 0) {
    escalation.escalate = true;
    escalation.reasons.push("knowledge_not_found");
  }

  let reply = humanHandoffReply(reference);
  let provider = "policy_handoff";
  if (!escalation.escalate) {
    try {
      const generated = await generateSupportDraft({
        ticketSubject: String(input.ticket.subject || "Support request"),
        issueType: String(input.ticket.issue_type || "general"),
        conversation,
        operatorGuidance: "Do not include a ticket number or source list; the server appends those. Do not claim access to customer-specific account or transaction data.",
        knowledge,
      });
      if (generated.draft.trim() === "HANDOFF_REQUIRED") {
        escalation.escalate = true;
        escalation.reasons.push("model_requested_handoff");
      } else if (!validateGroundedDraft(generated.draft, knowledge)) {
        reply = groundedFallback(reference, knowledge);
        provider = "knowledge_fallback";
      } else {
        reply = groundedReply(generated.draft, reference, knowledge);
        provider = generated.provider;
      }
    } catch {
      reply = groundedFallback(reference, knowledge);
      provider = "knowledge_fallback";
    }
  }

  if (escalation.escalate) {
    reply = humanHandoffReply(reference);
    provider = "policy_handoff";
  }

  const now = new Date().toISOString();
  const { error: replyError } = await supa.from("support_ticket_messages").insert({
    ticket_id: input.ticket.id,
    sender_type: "assistant",
    sender_user_id: null,
    body: reply,
    is_internal: false,
  });
  if (replyError) throw replyError;

  await supa.from("support_tickets").update({
    status: escalation.escalate ? "pending_support" : "pending_user",
    priority: escalation.escalate ? "high" : input.ticket.priority,
    first_response_at: now,
    last_message_at: now,
  }).eq("id", input.ticket.id);

  let notification: { sent: boolean; error?: string } = { sent: false, error: "not_required" };
  if (escalation.escalate) {
    notification = await sendOperatorHandoffEmail({
      ticketId: input.ticket.id,
      requesterEmail: String(input.ticket.requester_email || ""),
      requesterName: input.requesterName,
      issueType: String(input.ticket.issue_type || "general"),
      subject: String(input.ticket.subject || "Support request"),
      message: input.message,
      reasons: escalation.reasons,
      userMessageNumber: 1,
    });
  }

  await supa.from("support_ticket_events").insert({
    ticket_id: input.ticket.id,
    event_type: escalation.escalate ? "automatic_human_handoff" : "automatic_first_response",
    actor_user_id: null,
    payload: {
      ticket_number: reference,
      provider,
      knowledge_version: SUPPORT_KNOWLEDGE_VERSION,
      knowledge_ids: knowledge.map((entry) => entry.id),
      knowledge_sources: knowledgeSources(knowledge),
      reasons: escalation.reasons,
      operator_notification_sent: notification.sent,
      operator_notification_error: notification.error || null,
    },
  });
}

async function automateFollowupResponse(input: {
  ticket: any;
  message: string;
  requesterName?: string | null;
  userMessageNumber: number;
}): Promise<void> {
  const reference = ticketReference(input.ticket.id);
  const { data: rows } = await supa.from("support_ticket_messages")
    .select("sender_type,body,created_at")
    .eq("ticket_id", input.ticket.id)
    .eq("is_internal", false)
    .order("created_at", { ascending: true })
    .limit(30);
  const conversation = (rows || []).slice(-12).map((row: any) => ({
    sender_type: String(row.sender_type || "user"),
    body: String(row.body || ""),
    created_at: String(row.created_at || ""),
  }));
  const escalation = shouldForceHumanHandoff({
    issueType: String(input.ticket.issue_type || "general"),
    subject: String(input.ticket.subject || ""),
    conversation,
  });
  const knowledge = retrieveSupportKnowledge([
    String(input.ticket.subject || ""),
    input.message,
  ].join("\n"));
  if (!escalation.escalate && knowledge.length === 0) {
    escalation.escalate = true;
    escalation.reasons.push("knowledge_not_found");
  }

  let reply = humanHandoffReply(reference);
  let provider = "policy_handoff";
  if (!escalation.escalate) {
    try {
      const generated = await generateSupportDraft({
        ticketSubject: String(input.ticket.subject || "Support request"),
        issueType: String(input.ticket.issue_type || "general"),
        conversation,
        operatorGuidance: "Answer only from the supplied knowledge. Do not claim access to customer-specific account or transaction data.",
        knowledge,
      });
      if (generated.draft.trim() === "HANDOFF_REQUIRED") {
        escalation.escalate = true;
        escalation.reasons.push("model_requested_handoff");
      } else if (!validateGroundedDraft(generated.draft, knowledge)) {
        reply = groundedFallback(reference, knowledge);
        provider = "knowledge_fallback";
      } else {
        reply = groundedReply(generated.draft, reference, knowledge);
        provider = generated.provider;
      }
    } catch {
      reply = groundedFallback(reference, knowledge);
      provider = "knowledge_fallback";
    }
  }

  if (escalation.escalate) {
    reply = humanHandoffReply(reference);
    provider = "policy_handoff";
  }

  const now = new Date().toISOString();
  const { error: replyError } = await supa.from("support_ticket_messages").insert({
    ticket_id: input.ticket.id,
    sender_type: "assistant",
    sender_user_id: null,
    body: reply,
    is_internal: false,
  });
  if (replyError) throw replyError;

  await supa.from("support_tickets").update({
    status: escalation.escalate ? "pending_support" : "pending_user",
    priority: escalation.escalate ? "high" : input.ticket.priority,
    last_message_at: now,
  }).eq("id", input.ticket.id);

  let notification: { sent: boolean; error?: string } = { sent: false, error: "not_required" };
  if (escalation.escalate) {
    notification = await sendOperatorHandoffEmail({
      ticketId: input.ticket.id,
      requesterEmail: String(input.ticket.requester_email || ""),
      requesterName: input.requesterName,
      issueType: String(input.ticket.issue_type || "general"),
      subject: String(input.ticket.subject || "Support request"),
      message: input.message,
      reasons: escalation.reasons,
      userMessageNumber: input.userMessageNumber,
    });
  }

  await supa.from("support_ticket_events").insert({
    ticket_id: input.ticket.id,
    event_type: escalation.escalate
      ? "followup_human_handoff"
      : "automatic_followup_response",
    actor_user_id: null,
    payload: {
      ticket_number: reference,
      provider,
      user_message_number: input.userMessageNumber,
      knowledge_version: SUPPORT_KNOWLEDGE_VERSION,
      knowledge_ids: knowledge.map((entry) => entry.id),
      knowledge_sources: knowledgeSources(knowledge),
      reasons: escalation.reasons,
      operator_notification_sent: notification.sent,
      operator_notification_error: notification.error || null,
    },
  });
}

function continueSupportAutomation(task: Promise<void>): void {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  const guarded = task.catch(() => undefined);
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(guarded);
    return;
  }
  // Local/test runtimes do not expose EdgeRuntime. The guarded promise keeps
  // failures from affecting the already-persisted customer ticket.
  void guarded;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const action = String(body?.action || "").trim() as Action;
  if (!action) return json({ success: false, error: "action is required" }, 400);
  if (action.startsWith("admin_")) return json({ success: false, error: "Unsupported action" }, 400);

  const isPublicCreate = action === "public_create_ticket";

  let user: any = null;
  let isAdmin = false;
  if (!isPublicCreate) {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "Authorization required" }, 401);
    const { data: authData, error: authErr } = await supa.auth.getUser(token);
    user = authData?.user;
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
    // IMPORTANT: avoid auth-context drift in edge functions.
    // `is_borderpay_admin()` depends on the caller JWT context and can
    // evaluate incorrectly when executed via a service-role client.
    // Resolve admin status from admin_users using the authenticated user id.
    const { data: adminRow, error: adminErr } = await supa
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminErr && adminRow?.user_id) isAdmin = true;
  }

  const profile = user
    ? (await supa
      .from("user_profiles")
      .select("id, email, account_type, full_name")
      .eq("id", user.id)
      .maybeSingle()).data
    : null;

  if (action === "create_ticket") {
    const issueType = trimText(body?.issue_type, 64) || "general";
    const subject = trimText(body?.subject, 160);
    const message = trimText(body?.message, 4000);
    const source = trimText(body?.source, 32) || "app";
    if (!subject) return json({ success: false, error: "Subject is required" }, 400);
    if (!message) return json({ success: false, error: "Message is required" }, 400);
    if (!ISSUE_TYPES.has(issueType)) return json({ success: false, error: "Invalid issue type" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .insert({
        requester_user_id: user.id,
        requester_email: profile?.email || user.email || null,
        requester_account_type: String(profile?.account_type || "individual"),
        issue_type: issueType,
        source,
        subject,
        status: "open",
        priority: derivePriority(issueType),
      })
      .select("*")
      .single();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      sender_type: "user",
      sender_user_id: user.id,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);
    await supa.from("support_tickets").update({ last_message_at: new Date().toISOString() }).eq("id", ticket.id);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      event_type: "ticket_created",
      actor_user_id: user.id,
      payload: { source, issue_type: issueType },
    });

    continueSupportAutomation(
      automateFirstResponse({ ticket, message, requesterName: profile?.full_name || null })
        .catch(async (error) => {
          await supa.from("support_ticket_events").insert({
            ticket_id: ticket.id,
            event_type: "automatic_first_response_failed",
            actor_user_id: null,
            payload: { reason: String((error as Error)?.message || "unknown").slice(0, 300) },
          });
        }),
    );

    return json({ success: true, data: { ticket_id: ticket.id, ticket_number: ticketReference(ticket.id) } });
  }

  if (action === "public_create_ticket") {
    const issueType = trimText(body?.issue_type, 64) || "general";
    const subject = trimText(body?.subject, 160);
    const message = trimText(body?.message, 4000);
    const email = trimText(body?.email, 200).toLowerCase();
    const name = trimText(body?.name, 160);
    if (!subject) return json({ success: false, error: "Subject is required" }, 400);
    if (!message) return json({ success: false, error: "Message is required" }, 400);
    if (!email || !isValidEmail(email)) {
      return json({ success: false, error: "Valid email is required" }, 400);
    }
    if (!ISSUE_TYPES.has(issueType)) return json({ success: false, error: "Invalid issue type" }, 400);

    // Lightweight anti-spam throttle for website widget:
    // cap to 3 tickets per email in the trailing 2-minute window.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentRows, error: recentErr } = await supa
      .from("support_tickets")
      .select("id")
      .eq("source", "website")
      .eq("requester_email", email)
      .gte("created_at", twoMinutesAgo)
      .limit(4);
    if (recentErr) return json({ success: false, error: recentErr.message }, 500);
    if ((recentRows || []).length >= 3) {
      return json(
        { success: false, error: "Too many requests. Please wait a few minutes and try again." },
        429,
      );
    }

    const context = typeof body?.context === "object" && body?.context
      ? body.context
      : {};
    const pageUrl = trimText(context?.page_url, 500);
    const referrer = trimText(context?.referrer, 500);
    const userAgent = trimText(context?.user_agent, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .insert({
        requester_user_id: null,
        requester_email: email,
        requester_name: name || null,
        requester_account_type: "individual",
        issue_type: issueType,
        source: "website",
        subject,
        status: "open",
        priority: derivePriority(issueType),
      })
      .select("*")
      .single();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      sender_type: "user",
      sender_user_id: null,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);
    await supa.from("support_tickets").update({ last_message_at: new Date().toISOString() }).eq("id", ticket.id);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      event_type: "website_ticket_created",
      actor_user_id: null,
      payload: {
        issue_type: issueType,
        email,
        page_url: pageUrl || null,
        referrer: referrer || null,
        user_agent: userAgent || null,
      },
    });

    continueSupportAutomation(
      automateFirstResponse({ ticket, message, requesterName: name || null })
        .catch(async (error) => {
          await supa.from("support_ticket_events").insert({
            ticket_id: ticket.id,
            event_type: "automatic_first_response_failed",
            actor_user_id: null,
            payload: { reason: String((error as Error)?.message || "unknown").slice(0, 300) },
          });
        }),
    );

    return json({ success: true, data: { ticket_id: ticket.id, ticket_number: ticketReference(ticket.id) } });
  }

  if (action === "brevo_ingest") {
    const configuredSecret = trimText(Deno.env.get("SUPPORT_WEBHOOK_SECRET") || "", 200);
    if (configuredSecret) {
      const presented = trimText(
        req.headers.get("x-support-webhook-secret")
          || req.headers.get("x-brevo-signature")
          || body?.secret
          || "",
        200,
      );
      if (!presented || presented !== configuredSecret) {
        return json({ success: false, error: "Forbidden" }, 403);
      }
    }

    const email = trimText(firstString(
      body?.email,
      body?.visitor?.email,
      body?.contact?.email,
      body?.conversation?.email,
    ), 200).toLowerCase();
    if (!email || !isValidEmail(email)) {
      return json({ success: false, error: "Valid email is required" }, 400);
    }
    const subject = trimText(firstString(
      body?.subject,
      body?.conversation?.subject,
      body?.topic,
      "Website chat support request",
    ), 160);
    const message = trimText(firstString(
      body?.message,
      body?.content,
      body?.text,
      body?.conversation?.message,
    ), 4000);
    if (!message) return json({ success: false, error: "Message is required" }, 400);

    const issueTypeRaw = trimText(body?.issue_type, 64) || "general";
    const issueType = ISSUE_TYPES.has(issueTypeRaw) ? issueTypeRaw : "general";
    const requesterName = trimText(firstString(body?.name, body?.visitor?.name, body?.contact?.name), 160);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .insert({
        requester_user_id: null,
        requester_email: email,
        requester_name: requesterName || null,
        requester_account_type: "individual",
        issue_type: issueType,
        source: "website",
        subject,
        status: "open",
        priority: derivePriority(issueType),
      })
      .select("*")
      .single();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      sender_type: "user",
      sender_user_id: null,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);
    await supa.from("support_tickets").update({ last_message_at: new Date().toISOString() }).eq("id", ticket.id);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      event_type: "brevo_ticket_ingested",
      actor_user_id: null,
      payload: {
        source: "brevo",
      },
    });
    continueSupportAutomation(
      automateFirstResponse({ ticket, message, requesterName: requesterName || null })
        .catch(async (error) => {
          await supa.from("support_ticket_events").insert({
            ticket_id: ticket.id,
            event_type: "automatic_first_response_failed",
            actor_user_id: null,
            payload: { reason: String((error as Error)?.message || "unknown").slice(0, 300) },
          });
        }),
    );
    return json({ success: true, data: { ticket_id: ticket.id, ticket_number: ticketReference(ticket.id) } });
  }

  if (action === "list_tickets") {
    const limit = Math.min(Math.max(Number(body?.limit || 20), 1), 100);
    const { data: tickets, error } = await supa
      .from("support_tickets")
      .select("*")
      .eq("requester_user_id", user.id)
      .order("last_message_at", { ascending: false })
      .limit(limit);
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, data: { tickets: tickets || [] } });
  }

  if (action === "get_ticket") {
    const ticketId = trimText(body?.ticket_id, 80);
    if (!ticketId) return json({ success: false, error: "ticket_id is required" }, 400);

    let ticketQuery = supa.from("support_tickets").select("*").eq("id", ticketId).limit(1);
    if (!isAdmin) ticketQuery = ticketQuery.eq("requester_user_id", user.id);
    const { data: ticketRows, error: ticketErr } = await ticketQuery;
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);
    const ticket = (ticketRows || [])[0];
    if (!ticket) return json({ success: false, error: "Ticket not found" }, 404);

    let messages: any[] = [];
    let msgErr: any = null;
    // A ticket is returned before background AI triage completes. Briefly
    // long-poll the first thread read so already-released native clients do
    // not permanently cache a one-message conversation.
    const createdAt = new Date(String(ticket.created_at || "")).getTime();
    const shouldAwaitFirstResponse = ticket.status === "open"
      && Number.isFinite(createdAt)
      && Date.now() - createdAt < 120_000;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await supa
        .from("support_ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      messages = result.data || [];
      msgErr = result.error;
      if (!shouldAwaitFirstResponse || msgErr || messages.some((row: any) => row.sender_type !== "user") || attempt === 7) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    return json({ success: true, data: { ticket, messages: messages || [] } });
  }

  if (action === "add_message") {
    const ticketId = trimText(body?.ticket_id, 80);
    const message = trimText(body?.message, 4000);
    if (!ticketId || !message) return json({ success: false, error: "ticket_id and message are required" }, 400);

    const { data: ticket, error: ticketErr } = await supa
      .from("support_tickets")
      .select("id, requester_user_id, requester_email, requester_name, issue_type, subject, status, priority")
      .eq("id", ticketId)
      .eq("requester_user_id", user.id)
      .maybeSingle();
    if (ticketErr) return json({ success: false, error: ticketErr.message }, 500);
    if (!ticket) return json({ success: false, error: "Ticket not found" }, 404);

    const { count: priorUserMessageCount } = await supa
      .from("support_ticket_messages")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", ticketId)
      .eq("sender_type", "user")
      .eq("is_internal", false);

    const { error: msgErr } = await supa.from("support_ticket_messages").insert({
      ticket_id: ticketId,
      sender_type: "user",
      sender_user_id: user.id,
      body: message,
      is_internal: false,
    });
    if (msgErr) return json({ success: false, error: msgErr.message }, 500);

    await supa
      .from("support_tickets")
      .update({ status: "pending_support", last_message_at: new Date().toISOString() })
      .eq("id", ticketId)
      .eq("requester_user_id", user.id);

    await supa.from("support_ticket_events").insert({
      ticket_id: ticketId,
      event_type: "user_message",
      actor_user_id: user.id,
      payload: {},
    });

    const userMessageNumber = Number(priorUserMessageCount || 0) + 1;
    continueSupportAutomation(automateFollowupResponse({
      ticket,
      message,
      requesterName: ticket.requester_name || profile?.full_name || null,
      userMessageNumber,
    }).catch(async (error) => {
      await supa.from("support_ticket_events").insert({
        ticket_id: ticketId,
        event_type: "automatic_followup_response_failed",
        actor_user_id: null,
        payload: { reason: String((error as Error)?.message || "unknown").slice(0, 300) },
      });
    }));

    return json({ success: true, data: { ticket_id: ticketId, ticket_number: ticketReference(ticketId) } });
  }

  if (action === "support_health") {
    return json({ success: true, data: supportHealthSnapshot() });
  }

  return json({ success: false, error: "Unsupported action" }, 400);
});
