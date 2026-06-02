// auth-reset-password — request a password reset link (LOGGED send path).
//
// Flow:
//   • Generate a GoTrue recovery link via admin.generateLink({ type:'recovery' }).
//     P0-b keeps GoTrue recovery tokens unchanged — it only moves the EMAIL onto
//     the logged send-email path. No token redesign, no new token table.
//   • Send the branded reset email via the unified LOGGED `send-email`
//     (writes public.email_log before Resend; template individual.password_reset).
//
// ENUMERATION SAFETY (hard requirement):
//   • Always return the SAME generic success body for every request, whether or
//     not an account exists.
//   • An email (and an email_log row) is created ONLY when the account exists.
//     Non-existent emails return the identical body and send/log nothing.
//   • Never vary status code or body based on account existence.
//
// Auth model: verify_jwt = false (public forgot-password form). The call to
//   send-email is gated by SEND_EMAIL_INTERNAL_TOKEN (NOT the service-role key).
//   SUPABASE_SERVICE_ROLE_KEY is used ONLY for the admin generateLink call.
//
// Deploy:
//   supabase functions deploy auth-reset-password --project-ref orwrcpwsffjlvzuraxjc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL") ?? "";
// Service-role: used ONLY for the admin client (generateLink).
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Internal token for authenticating to send-email (NOT the service-role key).
const SEND_EMAIL_TOKEN      = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL               = Deno.env.get("BORDERPAY_APP_URL") ?? "https://app.borderpayafrica.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ONE uniform response for all reset requests — never existence-dependent.
const GENERIC_OK = {
  success: true,
  message: "If an account exists with that email, a reset link has been sent.",
};

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only" }, 405);

  let email = "";
  try {
    const body = await req.json();
    email = String(body?.email || "").trim().toLowerCase();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  if (!email) return json({ success: false, error: "Email is required" }, 400);

  try {
    // Generate a GoTrue recovery link. For a non-existent email this returns an
    // error (or no token); we swallow it and return the SAME generic response
    // with NO email and NO email_log row.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: APP_URL },
    });

    if (error || !data?.properties?.hashed_token) {
      return json(GENERIC_OK);
    }

    const token    = data.properties.hashed_token;
    const resetUrl = `${APP_URL}/#access_token=${token}&type=recovery`;
    const userId   = data.user?.id ?? null;
    const fullName = ((data.user?.user_metadata as Record<string, unknown> | undefined)
      ?.full_name as string | undefined) || email.split("@")[0];

    // Send via the LOGGED send-email path (writes public.email_log before Resend).
    // Idempotency key is NON-SENSITIVE: userId + a random UUID. It must NEVER
    // contain any portion of the recovery token (`token`/hashed_token).
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
        },
        body: JSON.stringify({
          template:        "individual.password_reset",
          to:              email,
          user_id:         userId,
          idempotency_key: `pwreset:${userId ?? "unknown"}:${crypto.randomUUID()}`,
          props: {
            full_name:          fullName,
            reset_url:          resetUrl,
            expires_in_minutes: 60,
          },
        }),
      });
    } catch (_e) {
      // Swallow send errors so the response stays uniform; send-email's
      // email_log row captures any failure for observability.
    }

    return json(GENERIC_OK);
  } catch (_e) {
    // Unexpected infra error (not existence-dependent). Stay generic.
    return json({ success: false, error: "Unable to process request. Please try again." }, 500);
  }
});
