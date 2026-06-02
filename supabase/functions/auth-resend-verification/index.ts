// auth-resend-verification — re-issue a verification email with rate limit.
//
// Body: { email: string }
//
// Behaviour:
//   • Looks up the user by email (service-role client).
//   • If the user is already email_confirmed, returns success with
//     { already_verified: true } and does NOT send an email.
//   • Otherwise: issues a fresh token via issue_email_token() (which
//     enforces 60 s cooldown + 3-per-hour cap server-side) and calls
//     send-confirmation-email (the deployed sender; see body of this
//     function for the rationale and the path back to the unified
//     send-email when that lands). Errors from the rate limit return
//     429 with a clear `code: 'cooldown' | 'rate_limit'`.
//
// Auth model: verify_jwt = false. The endpoint takes the email as input;
//   sensitive data is gated by the rate limiter and the token system itself.
//
// Deploy:
//   supabase functions deploy auth-resend-verification --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL               = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only" }, 405);

  let body: { email?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return json({ success: false, error: "email required" }, 400);

  // Look up user (service role)
  const { data: userRow, error: lookupErr } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, account_type")
    .ilike("email", email)
    .maybeSingle();
  if (lookupErr) {
    return json({ success: false, error: `lookup failed: ${lookupErr.message}` }, 500);
  }
  // Don't leak which emails exist — return a soft success even when the
  // user doesn't exist. (No email is sent in that case.)
  if (!userRow) {
    return json({ success: true, data: { sent: false, reason: "no_op" } });
  }

  // If already confirmed, no need to send.
  const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userRow.id);
  if (authUser?.email_confirmed_at) {
    return json({ success: true, data: { sent: false, already_verified: true } });
  }

  const purpose = userRow.account_type === "business" ? "signup_business" : "signup_individual";

  // Issue token (rate-limited inside the function)
  const xff = req.headers.get("x-forwarded-for") || "";
  const ua  = req.headers.get("user-agent") || "";
  const { data: tokenData, error: tokenErr } = await supabase.rpc("issue_email_token", {
    p_user_id:     userRow.id,
    p_purpose:     purpose,
    p_ttl_minutes: 60 * 24,
    p_ip:          xff.split(",")[0]?.trim() || null,
    p_ua:          ua,
  });
  if (tokenErr) {
    const msg  = tokenErr.message || "token issue failed";
    const code = /too many tokens/i.test(msg) ? "rate_limit"
              : /please wait/i.test(msg)      ? "cooldown"
              :                                 "internal";
    const status = code === "rate_limit" || code === "cooldown" ? 429 : 500;
    return json({ success: false, error: msg, code }, status);
  }

  const verifyUrl = `${APP_URL}/auth/verify?token=${encodeURIComponent(tokenData as string)}&purpose=${purpose}`;

  // Email P0: route through the LOGGED `send-email` function (writes
  // public.email_log before calling Resend; records status / message-id /
  // error / attempts / idempotency). Replaces the unlogged
  // `send-confirmation-email` path so resend deliverability is observable.
  // Resend stays rate-limited by issue_email_token() above; this only changes
  // the sender. Behaviour preserved: this endpoint already returns soft success
  // for unknown emails (enumeration-safe) BEFORE reaching here.
  //
  // DEPLOY ORDER (lockstep): `send-email` MUST be deployed BEFORE this function
  // or the call 404s. Source-only PR; no deploy here.
  const emailTemplate = userRow.account_type === "business"
    ? "business.email_verification"
    : "individual.email_verification";
  const sendRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
    },
    body: JSON.stringify({
      template:        emailTemplate,
      to:              userRow.email,
      user_id:         userRow.id,
      idempotency_key: `verify-resend:${userRow.id}:${(tokenData as string).slice(0, 16)}`,
      props: {
        full_name:        userRow.full_name,
        verification_url: verifyUrl,
      },
    }),
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok || !(sendJson as any)?.success) {
    return json(
      {
        success: false,
        error:   (sendJson as any)?.error || `send-confirmation-email HTTP ${sendRes.status}`,
      },
      502,
    );
  }

  return json({ success: true, data: { sent: true } });
});
