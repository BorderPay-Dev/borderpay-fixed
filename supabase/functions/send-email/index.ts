// send-email — unified transactional email entrypoint.
//
// Single send path for every BorderPay email. Renders one of the registered
// templates, calls Resend, logs the attempt to public.email_log, and retries
// on transient failures.
//
// Auth model:
//   • verify_jwt = false  (called server-to-server from other edge functions
//     and from cron jobs; gated by an internal bearer token).
//   • The HTTP request MUST present `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.
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
//   { success: true,  data: { resend_id, log_id, status } }
//   { success: false, error: string, log_id?: uuid }
//
// Deploy:
//   supabase functions deploy send-email --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { renderTemplate, TemplateName } from "../_shared/email-templates/index.ts";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY            = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL            = Deno.env.get("BORDERPAY_FROM_EMAIL") ?? "BorderPay Africa <noreply@app.borderpayafrica.com>";

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

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only" }, 405);

  // AuthN: must present the service-role token (we don't accept user JWTs here).
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!SUPABASE_SERVICE_ROLE || token !== SUPABASE_SERVICE_ROLE) {
    return json({ success: false, error: "Unauthorized — service-role required" }, 401);
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
      return json({ success: true, data: { resend_id: existing.resend_id, log_id: existing.id, status: "sent", deduped: true } });
    }
  }

  // ── Send with retry/backoff ────────────────────────────────────────────
  if (!RESEND_KEY) {
    await markFailed(logId, "RESEND_API_KEY missing");
    return json({ success: false, error: "Email service not configured (RESEND_API_KEY missing)", log_id: logId }, 500);
  }

  await supabaseAdmin
    .from("email_log")
    .update({ status: "sending", attempts: 1 })
    .eq("id", logId);

  const maxAttempts = 4;
  let lastError = "";
  let resendId  = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [body.to],
          subject: rendered.subject,
          html:    rendered.html,
          text:    rendered.text,
          ...(body.reply_to ? { reply_to: body.reply_to } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data as any)?.id) {
        resendId  = (data as any).id;
        lastError = "";
        break;
      }
      lastError = `Resend HTTP ${res.status}: ${(data as any)?.message || JSON.stringify(data).slice(0, 300)}`;
      // 4xx = don't retry (validation, missing-from, etc.); 5xx + network = retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
    } catch (e) {
      lastError = `Resend network: ${(e as Error).message}`;
    }
    if (attempt < maxAttempts) {
      const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      await supabaseAdmin
        .from("email_log")
        .update({ attempts: attempt + 1, last_error: lastError })
        .eq("id", logId);
      await sleep(backoffMs);
    }
  }

  if (resendId) {
    await supabaseAdmin
      .from("email_log")
      .update({
        status:    "sent",
        resend_id: resendId,
        sent_at:   new Date().toISOString(),
        last_error: null,
      })
      .eq("id", logId);
    return json({ success: true, data: { resend_id: resendId, log_id: logId, status: "sent" } });
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
