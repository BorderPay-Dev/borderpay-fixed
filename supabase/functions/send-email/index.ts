// send-email — unified transactional email entrypoint.
//
// Single send path for every BorderPay email. Renders one of the registered
// templates, calls the configured transactional email provider, logs the attempt
// to public.email_log, and retries on transient failures.
//
// Auth model:
//   • verify_jwt = false  (called server-to-server from other edge functions
//     and from cron jobs; gated by an internal bearer token).
//   • The HTTP request MUST present `Authorization: Bearer <SEND_EMAIL_INTERNAL_TOKEN>`.
//     (NOT the service-role key — that stays internal, for the admin DB client only.)
//
// Body:
//   {
//     template:        TemplateName,           // see _shared/email-templates
//     to:              string,
//     props:           Record<string, any>,    // template-specific
//     user_id?:        uuid,                   // for email_log foreign key
//     idempotency_key?:string,                 // dedupe identical sends
//     reply_to?:       string,
//     attachments?:    [{ name, content? | url? }],
//   }
//
// Returns:
//   { success: true,  data: { provider_id, log_id, status } }
//   { success: false, error: string, log_id?: uuid }
//
// Deploy:
//   supabase functions deploy send-email --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { renderTemplate, TemplateName } from "../_shared/email-templates/index.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
// SUPABASE_SERVICE_ROLE_KEY is used ONLY for the in-function admin DB client
// (log_email_attempt RPC + email_log writes). It is NOT the HTTP caller password.
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BREVO_KEY             = Deno.env.get("BREVO_API_KEY") ?? Deno.env.get("BREVO_API_KEYS") ?? "";
const RESEND_KEY            = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_PROVIDER        = (Deno.env.get("EMAIL_PROVIDER") ?? "").trim().toLowerCase();
const FROM_EMAIL            = Deno.env.get("BORDERPAY_FROM_EMAIL") ?? "BorderPay Africa <noreply@borderpayafrica.com>";
const BREVO_FROM_EMAIL      = Deno.env.get("BREVO_FROM_EMAIL") ?? FROM_EMAIL;
const RESEND_FROM_EMAIL     = Deno.env.get("RESEND_FROM_EMAIL") ?? FROM_EMAIL;
// Dedicated internal caller token. send-email is invoked server-to-server only
// (auth-signup / auth-resend-verification / cron). The HTTP gate compares the
// bearer to THIS secret — never to the service-role key — so the email sender
// is least-privilege and independently rotatable. Fails closed if unset.
const INTERNAL_TOKEN        = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

interface SendEmailBody {
  template:         TemplateName;
  to:               string;
  props?:           Record<string, unknown>;
  user_id?:         string;
  tenant_id?:       string;
  idempotency_key?: string;
  reply_to?:        string;
  attachments?:     EmailAttachment[];
}

interface EmailAttachment {
  name:    string;
  content?: string;
  url?:     string;
}

type EmailProvider = "brevo" | "resend";

interface ProviderSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  fromName?: string;
  attachments: EmailAttachment[];
}

interface ProviderSendResult {
  ok: boolean;
  provider: EmailProvider;
  providerId: string;
  error: string;
  retryable: boolean;
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type WhiteLabelEmailContext = {
  tenantId: string;
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  senderName: string;
  replyTo: string | null;
  deliveryMode: "borderpay_managed" | "partner_webhook";
};

const DEFAULT_LOGO_URL = "https://orwrcpwsffjlvzuraxjc.supabase.co/storage/v1/object/public/email-logo.png/assets/borderpay-email-logo.png";
const safeEmail = (value: unknown) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
const safeHttps = (value: unknown) => {
  if (typeof value !== "string") return null;
  try { const parsed = new URL(value.trim()); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; }
};
const safeLabel = (value: unknown) => String(value || "").replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const escapeBrand = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function loadWhiteLabelEmailContext(body: SendEmailBody): Promise<WhiteLabelEmailContext | null> {
  const tenantId = String(body.tenant_id || "").trim();
  if (!tenantId) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) throw new Error("Invalid tenant_id");
  const [{ data: tenant }, { data: approval }] = await Promise.all([
    supabaseAdmin.from("api_tenants").select("id,is_active,metadata").eq("id", tenantId).maybeSingle(),
    supabaseAdmin.from("api_partner_approvals").select("status,approved_products").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!tenant?.is_active || approval?.status !== "approved" || !Array.isArray(approval.approved_products) || !approval.approved_products.includes("white_label")) {
    throw new Error("Active white-label partner approval is required");
  }
  if (!body.user_id) throw new Error("White-label email requires a tenant-owned user");
  const { data: provenance } = await supabaseAdmin.from("account_origin_provenance")
    .select("tenant_id").eq("user_id", body.user_id).eq("tenant_id", tenantId).maybeSingle();
  if (!provenance) throw new Error("Email recipient is not owned by this partner tenant");
  const white = tenant.metadata?.white_label && typeof tenant.metadata.white_label === "object" ? tenant.metadata.white_label as Record<string, unknown> : {};
  const brandName = safeLabel(white.app_name || white.brand_name);
  if (white.enabled !== true || !brandName) throw new Error("White-label email branding is not published");
  const primaryColor = typeof white.primary_color === "string" && /^#[0-9a-f]{6}$/i.test(white.primary_color.trim()) ? white.primary_color.trim().toUpperCase() : "#C7FF00";
  const deliveryMode = white.email_delivery_mode === "partner_webhook" ? "partner_webhook" : "borderpay_managed";
  return { tenantId, brandName, primaryColor, logoUrl: safeHttps(white.logo_url), supportEmail: safeEmail(white.support_email), senderName: safeLabel(white.email_sender_name || brandName), replyTo: safeEmail(white.email_reply_to), deliveryMode };
}

function applyWhiteLabelEmail(rendered: { subject: string; html: string; text: string }, brand: WhiteLabelEmailContext) {
  const htmlName = escapeBrand(brand.brandName);
  let html = rendered.html.replace(/BorderPay Africa|BorderPay/g, () => htmlName)
    .replaceAll("#C7FF00", brand.primaryColor).replaceAll("#c7ff00", brand.primaryColor);
  if (brand.logoUrl) html = html.replaceAll(DEFAULT_LOGO_URL, escapeBrand(brand.logoUrl));
  if (brand.supportEmail) html = html.replaceAll("support@borderpayafrica.com", escapeBrand(brand.supportEmail));
  return {
    subject: rendered.subject.replace(/BorderPay Africa|BorderPay/g, () => brand.brandName),
    html,
    text: rendered.text.replace(/BorderPay Africa|BorderPay/g, () => brand.brandName)
      .replaceAll("support@borderpayafrica.com", brand.supportEmail || "support@borderpayafrica.com"),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only" }, 405);

  // AuthN: internal server-to-server only.
  // Dedicated least-privilege caller credential. Never accept the Supabase
  // service-role key as an HTTP password for this endpoint.
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!INTERNAL_TOKEN || !timingSafeEqualStr(token, INTERNAL_TOKEN)) {
    return json({ success: false, error: "Unauthorized — internal token required" }, 401);
  }

  let body: SendEmailBody;
  try { body = (await req.json()) as SendEmailBody; }
  catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  if (!body.template) return json({ success: false, error: "template required" }, 400);
  if (!body.to)       return json({ success: false, error: "to required" }, 400);

  let attachments: EmailAttachment[] = [];
  try {
    attachments = sanitizeAttachments(body.attachments);
  } catch (e) {
    return json({ success: false, error: (e as Error).message }, 400);
  }

  let whiteLabel: WhiteLabelEmailContext | null = null;
  try { whiteLabel = await loadWhiteLabelEmailContext(body); }
  catch (e) { return json({ success: false, error: (e as Error).message }, 403); }

  // ── Render the template ────────────────────────────────────────────────
  let rendered;
  try {
    rendered = renderTemplate(body.template, body.props ?? {});
    if (whiteLabel) rendered = applyWhiteLabelEmail(rendered, whiteLabel);
  } catch (e) {
    return json({ success: false, error: `Render failed: ${(e as Error).message}` }, 400);
  }

  // ── Idempotency / pre-write to email_log ───────────────────────────────
  const { data: logId, error: logErr } = await supabaseAdmin.rpc("log_email_attempt", {
    p_user_id:   body.user_id ?? null,
    p_recipient: body.to,
    p_template:  body.template,
    p_subject:   rendered.subject,
    p_payload:   { props: body.props ?? {}, ...(whiteLabel ? { tenant_id: whiteLabel.tenantId, white_label: true } : {}) },
    p_idem_key:  body.idempotency_key ?? null,
  });
  if (logErr) {
    return json({ success: false, error: `email_log insert failed: ${logErr.message}` }, 500);
  }

  // Claim exactly one queued row for this idempotency key. A fresh row starts
  // as queued/attempts=0, while duplicate workers receive the same row id and
  // fail this conditional update after the first worker claims it.
  const { data: claimed } = await supabaseAdmin
    .from("email_log")
    .update({ status: "sending", attempts: 1 })
    .eq("id", logId)
    .eq("status", "queued")
    .eq("attempts", 0)
    .select("id")
    .maybeSingle();
  if (!claimed?.id) {
    const { data: existing } = await supabaseAdmin
      .from("email_log")
      .select("id, status, resend_id")
      .eq("id", logId)
      .single();
    return json({
      success: true,
      data: {
        resend_id: existing?.resend_id ?? null,
        log_id: existing?.id ?? logId,
        status: existing?.status ?? "queued",
        deduped: true,
      },
    });
  }

  if (whiteLabel?.deliveryMode === "partner_webhook") {
    const { error: webhookError } = await supabaseAdmin.rpc("api_webhook_enqueue_event", {
      p_tenant_id: whiteLabel.tenantId,
      p_tenant_end_user_id: null,
      p_resource_id: logId,
      p_event_type: "email.delivery_requested",
      p_idempotency_key: `partner:email:${logId}:delivery_requested`,
      p_payload: {
        email: {
          id: logId,
          template: body.template,
          to: body.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          sender_name: whiteLabel.senderName,
          reply_to: whiteLabel.replyTo,
        },
      },
      p_occurred_at: new Date().toISOString(),
    });
    if (webhookError) {
      await markFailed(logId, `Partner delivery webhook could not be queued: ${webhookError.message}`);
      return json({ success: false, error: "Partner email delivery is temporarily unavailable", log_id: logId }, 502);
    }
    await supabaseAdmin.from("email_log").update({ status: "queued", resend_id: "partner_webhook", last_error: null }).eq("id", logId);
    return json({ success: true, data: { provider: "partner_webhook", provider_id: null, resend_id: null, log_id: logId, status: "queued" } });
  }

  // ── Send with retry/backoff ────────────────────────────────────────────
  const providers = emailProviderOrder();
  if (providers.length === 0) {
    await markFailed(logId, "No email provider configured");
    return json({ success: false, error: "Email service not configured", log_id: logId }, 500);
  }

  const maxAttempts = 4;
  let lastError = "";
  let providerId  = "";
  let providerUsed: EmailProvider | "" = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptErrors: string[] = [];
    for (const provider of providers) {
      const result = await sendWithProvider(provider, {
        to: body.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        replyTo: whiteLabel?.replyTo || body.reply_to,
        fromName: whiteLabel?.senderName,
        attachments,
      });
      if (result.ok) {
        providerId = result.providerId;
        providerUsed = result.provider;
        lastError = "";
        break;
      }
      attemptErrors.push(result.error);
      if (!result.retryable) break;
    }
    if (providerId) break;
    lastError = attemptErrors.join(" | ") || "Email provider failed";
    if (attemptErrors.some((err) => /HTTP 4\d\d/.test(err) && !/HTTP (408|429)/.test(err))) break;
    if (attempt < maxAttempts) {
      const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      await supabaseAdmin
        .from("email_log")
        .update({ attempts: attempt + 1, last_error: lastError })
        .eq("id", logId);
      await sleep(backoffMs);
    }
  }

  if (providerId) {
    await supabaseAdmin
      .from("email_log")
      .update({
        status:    "sent",
        resend_id: providerUsed ? `${providerUsed}:${providerId}` : providerId,
        sent_at:   new Date().toISOString(),
        last_error: null,
      })
      .eq("id", logId);
    if (whiteLabel) await recordPartnerEmailOutcome(whiteLabel.tenantId, logId, body.template, "sent", providerUsed || null);
    return json({ success: true, data: { provider: providerUsed, provider_id: providerId, resend_id: providerId, log_id: logId, status: "sent" } });
  }

  await markFailed(logId, lastError || "Unknown send failure");
  if (whiteLabel) await recordPartnerEmailOutcome(whiteLabel.tenantId, logId, body.template, "failed", providerUsed || null);
  return json({ success: false, error: lastError || "Email send failed", log_id: logId }, 502);
});

async function recordPartnerEmailOutcome(tenantId: string, logId: string, template: string, status: "sent" | "failed", provider: string | null) {
  const { error } = await supabaseAdmin.from("partner_email_usage_events").upsert({ tenant_id: tenantId, email_log_id: logId, template, delivery_status: status, provider, units: 1, billable: status === "sent" }, { onConflict: "tenant_id,email_log_id" });
  if (error) console.error("partner email usage write failed", error.message);
  const { error: webhookError } = await supabaseAdmin.rpc("api_webhook_enqueue_event", {
    p_tenant_id: tenantId, p_tenant_end_user_id: null, p_resource_id: null,
    p_event_type: status === "sent" ? "email.sent" : "email.failed",
    p_idempotency_key: `partner:email:${logId}:${status}`,
    p_payload: { email: { id: logId, template, status } },
    p_occurred_at: new Date().toISOString(),
  });
  if (webhookError) console.error("partner email webhook enqueue failed", webhookError.message);
}

async function markFailed(logId: string, message: string) {
  await supabaseAdmin
    .from("email_log")
    .update({ status: "failed", last_error: message.slice(0, 1000) })
    .eq("id", logId);
}

function emailProviderOrder(): EmailProvider[] {
  if (EMAIL_PROVIDER === "resend") return RESEND_KEY ? ["resend"] : [];
  if (EMAIL_PROVIDER === "brevo") return BREVO_KEY ? ["brevo"] : [];
  if (EMAIL_PROVIDER === "resend_then_brevo") {
    return [
      ...(RESEND_KEY ? ["resend" as const] : []),
      ...(BREVO_KEY ? ["brevo" as const] : []),
    ];
  }
  if (EMAIL_PROVIDER === "brevo_then_resend") {
    return [
      ...(BREVO_KEY ? ["brevo" as const] : []),
      ...(RESEND_KEY ? ["resend" as const] : []),
    ];
  }
  // Default preserves current production behavior. Set EMAIL_PROVIDER=resend
  // during a Brevo incident because Brevo may accept messages while delaying
  // delivery internally, which cannot be detected from the send API response.
  return BREVO_KEY ? ["brevo"] : (RESEND_KEY ? ["resend"] : []);
}

async function sendWithProvider(provider: EmailProvider, input: ProviderSendInput): Promise<ProviderSendResult> {
  if (provider === "resend") return sendWithResend(input);
  return sendWithBrevo(input);
}

async function sendWithBrevo(input: ProviderSendInput): Promise<ProviderSendResult> {
  if (!BREVO_KEY) {
    return { ok: false, provider: "brevo", providerId: "", error: "Brevo API key missing", retryable: false };
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept":        "application/json",
        "content-type":  "application/json",
        "api-key":       BREVO_KEY,
      },
      body: JSON.stringify({
        sender:      input.fromName ? { ...parseFrom(BREVO_FROM_EMAIL), name: input.fromName } : parseFrom(BREVO_FROM_EMAIL),
        to:          [{ email: input.to }],
        subject:     input.subject,
        htmlContent: input.html,
        textContent: input.text,
        ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
        ...(input.attachments.length ? { attachment: input.attachments } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    const msgId = String((data as any)?.messageId || "");
    if (res.ok && msgId) {
      return { ok: true, provider: "brevo", providerId: msgId, error: "", retryable: false };
    }
    return {
      ok: false,
      provider: "brevo",
      providerId: "",
      error: `Brevo HTTP ${res.status}: ${(data as any)?.message || JSON.stringify(data).slice(0, 300)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
    };
  } catch (e) {
    return { ok: false, provider: "brevo", providerId: "", error: `Brevo network: ${(e as Error).message}`, retryable: true };
  }
}

async function sendWithResend(input: ProviderSendInput): Promise<ProviderSendResult> {
  if (!RESEND_KEY) {
    return { ok: false, provider: "resend", providerId: "", error: "Resend API key missing", retryable: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${RESEND_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: input.fromName ? formatFromName(RESEND_FROM_EMAIL, input.fromName) : RESEND_FROM_EMAIL,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments.length
          ? { attachments: input.attachments.map((a) => ({ filename: a.name, content: a.content, path: a.url })).filter((a) => a.content || a.path) }
          : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    const msgId = String((data as any)?.id || "");
    if (res.ok && msgId) {
      return { ok: true, provider: "resend", providerId: msgId, error: "", retryable: false };
    }
    return {
      ok: false,
      provider: "resend",
      providerId: "",
      error: `Resend HTTP ${res.status}: ${(data as any)?.message || (data as any)?.error || JSON.stringify(data).slice(0, 300)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
    };
  } catch (e) {
    return { ok: false, provider: "resend", providerId: "", error: `Resend network: ${(e as Error).message}`, retryable: true };
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function parseFrom(raw: string): { email: string; name?: string } {
  const m = raw.match(/^(.*)<([^>]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    const email = m[2].trim();
    return name ? { email, name } : { email };
  }
  return { email: raw.trim() };
}

function formatFromName(raw: string, name: string): string {
  const parsed = parseFrom(raw);
  const cleanName = name.replace(/[\r\n<>]/g, " ").trim().slice(0, 80);
  return `${cleanName || parsed.name || "BorderPay Africa"} <${parsed.email}>`;
}

function sanitizeAttachments(raw: unknown): EmailAttachment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("attachments must be an array");
  if (raw.length > 5) throw new Error("attachments limit is 5 files");
  return raw.map((item, idx) => {
    const a = item as Partial<EmailAttachment>;
    const name = String(a?.name || "").trim();
    const content = typeof a?.content === "string" ? a.content.trim() : "";
    const url = typeof a?.url === "string" ? a.url.trim() : "";
    if (!name) throw new Error(`attachments[${idx}].name required`);
    if (!/^[a-zA-Z0-9._ ()-]{1,140}$/.test(name)) throw new Error(`attachments[${idx}].name has unsupported characters`);
    if (content && url) throw new Error(`attachments[${idx}] must use content or url, not both`);
    if (!content && !url) throw new Error(`attachments[${idx}] requires content or url`);
    if (content && !/^[A-Za-z0-9+/=\r\n]+$/.test(content)) throw new Error(`attachments[${idx}].content must be base64`);
    if (url && !/^https:\/\//i.test(url)) throw new Error(`attachments[${idx}].url must be https`);
    return content ? { name, content } : { name, url };
  });
}

// Constant-time string comparison for the internal auth token. Returns false
// immediately on length mismatch (length is not secret); otherwise compares all
// bytes without an early-exit so timing does not leak how many chars matched.
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
