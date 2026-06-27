// send-email — unified transactional email entrypoint.
//
// Single send path for every BorderPay email. Renders one of the registered
// templates, calls Brevo (preferred) or Resend fallback, logs the attempt to
// public.email_log, and retries on transient failures.
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
const FROM_EMAIL            = Deno.env.get("BORDERPAY_FROM_EMAIL") ?? "BorderPay Africa <noreply@app.borderpayafrica.com>";
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
}

interface ProviderSendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
  retryable?: boolean;
  authFailure?: boolean;
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only" }, 405);

  // AuthN: internal server-to-server only. The bearer MUST equal the dedicated
  // SEND_EMAIL_INTERNAL_TOKEN secret — NOT the service-role key, and never a
  // user/anon JWT. Fail closed if the secret is unset. Constant-time compare;
  // the token is never logged.
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

  // If the idempotency key matched an existing successful send, log_email_attempt
  // returns the existing row id with status='sent' (or 'queued'/'sending'). Bail
  // out here without re-sending.
  {
    const { data: existing } = await supabaseAdmin
      .from("email_log")
      .select("id, status, resend_id")
      .eq("id", logId)
      .single();
    if (existing && existing.status === "sent") {
      return json({ success: true, data: { provider_id: existing.resend_id, log_id: existing.id, status: "sent", deduped: true } });
    }
  }

  // ── Send with retry/backoff ────────────────────────────────────────────
  const emailProvider = BREVO_KEY ? "brevo" : RESEND_KEY ? "resend" : "none";
  if (emailProvider === "none") {
    await markFailed(logId, "No provider key configured (BREVO_API_KEY / RESEND_API_KEY missing)");
    return json({ success: false, error: "Email service not configured", log_id: logId }, 500);
  }

  await supabaseAdmin
    .from("email_log")
    .update({ status: "sending", attempts: 1 })
    .eq("id", logId);

  const maxAttempts = 4;
  let lastError = "";
  let providerId = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let sendResult = emailProvider === "brevo"
      ? await sendViaBrevo({ to: body.to, subject: rendered.subject, html: rendered.html, text: rendered.text, reply_to: body.reply_to })
      : await sendViaResend({ to: body.to, subject: rendered.subject, html: rendered.html, text: rendered.text, reply_to: body.reply_to });
    let brevoError = "";
    if (!sendResult.ok && emailProvider === "brevo" && sendResult.authFailure && RESEND_KEY) {
      brevoError = sendResult.error || "Brevo auth failure";
      sendResult = await sendViaResend({ to: body.to, subject: rendered.subject, html: rendered.html, text: rendered.text, reply_to: body.reply_to });
      if (!sendResult.ok) {
        sendResult.error = `${brevoError}; fallback ${sendResult.error || "Resend failure"}`;
      }
    }
    if (sendResult.ok && sendResult.providerId) {
      providerId = sendResult.providerId;
      lastError = "";
      break;
    }
    lastError = sendResult.error || `${emailProvider} send failed`;
    if (!sendResult.retryable) break;
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
        // Keep legacy column name for backward compatibility; value now stores
        // provider message id (Brevo messageId or Resend id).
        resend_id: providerId,
        sent_at:   new Date().toISOString(),
        last_error: null,
      })
      .eq("id", logId);
    return json({ success: true, data: { provider_id: providerId, log_id: logId, status: "sent", provider: emailProvider } });
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

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function sendViaResend(input: { to: string; subject: string; html: string; text: string; reply_to?: string }): Promise<ProviderSendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.reply_to ? { reply_to: input.reply_to } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data as Record<string, unknown>)?.id) {
      return { ok: true, providerId: String((data as Record<string, unknown>).id) };
    }
    const retryable = !(res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
    return {
      ok: false,
      retryable,
      error: `Resend HTTP ${res.status}: ${String((data as Record<string, unknown>)?.message || JSON.stringify(data).slice(0, 300))}`,
    };
  } catch (e) {
    return { ok: false, retryable: true, error: `Resend network: ${(e as Error).message}` };
  }
}

async function sendViaBrevo(input: { to: string; subject: string; html: string; text: string; reply_to?: string }): Promise<ProviderSendResult> {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_KEY,
      },
      body: JSON.stringify({
        sender: parseSender(FROM_EMAIL),
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
        headers: {
          "X-Mailin-track": "0",
        },
        ...(input.reply_to ? { replyTo: { email: input.reply_to } } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && (data as Record<string, unknown>)?.messageId) {
      return { ok: true, providerId: String((data as Record<string, unknown>).messageId) };
    }
    const retryable = !(res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
    return {
      ok: false,
      authFailure: res.status === 401 || res.status === 403,
      retryable,
      error: `Brevo HTTP ${res.status}: ${String((data as Record<string, unknown>)?.message || JSON.stringify(data).slice(0, 300))}`,
    };
  } catch (e) {
    return { ok: false, retryable: true, error: `Brevo network: ${(e as Error).message}` };
  }
}

function parseSender(raw: string): { email: string; name?: string } {
  const match = raw.match(/^\s*([^<]+?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]?.trim();
    const email = match[2]?.trim();
    return name ? { name, email } : { email };
  }
  return { email: raw.trim() };
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
