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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only" }, 405);

  // AuthN: internal server-to-server only.
  // Primary credential: SEND_EMAIL_INTERNAL_TOKEN.
  // Compatibility path: allow service-role bearer as an internal caller token
  // to prevent cross-repo secret drift from blocking production email sends.
  // (Both are high-entropy secrets; token is never logged.)
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const internalOk = INTERNAL_TOKEN ? timingSafeEqualStr(token, INTERNAL_TOKEN) : false;
  const serviceRoleOk = SUPABASE_SERVICE_ROLE ? timingSafeEqualStr(token, SUPABASE_SERVICE_ROLE) : false;
  if (!(internalOk || serviceRoleOk)) {
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

  // ── Render the template ────────────────────────────────────────────────
  let rendered;
  try {
    rendered = renderTemplate(body.template, body.props ?? {});
  } catch (e) {
    return json({ success: false, error: `Render failed: ${(e as Error).message}` }, 400);
  }

  // ── Idempotency / pre-write to email_log ───────────────────────────────
  const { data: logId, error: logErr } = await supabaseAdmin.rpc("log_email_attempt", {
    p_user_id:   body.user_id ?? null,
    p_recipient: body.to,
    p_template:  body.template,
    p_subject:   rendered.subject,
    p_payload:   { props: body.props ?? {} },
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
        replyTo: body.reply_to,
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
    return json({ success: true, data: { provider: providerUsed, provider_id: providerId, resend_id: providerId, log_id: logId, status: "sent" } });
  }

  await markFailed(logId, lastError || "Unknown send failure");
  return json({ success: false, error: lastError || "Email send failed", log_id: logId }, 502);
});

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
        sender:      parseFrom(BREVO_FROM_EMAIL),
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
        from: RESEND_FROM_EMAIL,
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
