// verify-email-token — consumes a signed email-verification token.
//
// On a successful verification:
//   • marks `auth.users.email_confirmed_at` = now() for the owning user
//   • marks the token used (idempotent: a re-used token returns 410 Gone)
//   • returns a redirect URL the client navigates to
//
// Body:
//   { token: string, purpose: 'signup_individual' | 'signup_business' | 'password_reset' | 'email_change' }
//
// Returns:
//   { success: true,  data: { user_id, purpose, redirect } }
//   { success: false, error: string, code: 'expired' | 'already_used' | 'not_found' | 'purpose_mismatch' | 'malformed' | 'internal' }
//
// Auth model:
//   • verify_jwt = false (this is exposed publicly so users can verify
//     without a session). The token IS the credential.
//
// Deploy:
//   supabase functions deploy verify-email-token --project-ref orwrcpwsffjlvzuraxjc

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

const ALLOWED_PURPOSES = new Set(["signup_individual", "signup_business", "password_reset", "email_change"]);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "POST only", code: "method_not_allowed" }, 405);

  let body: { token?: string; purpose?: string };
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON", code: "malformed" }, 400); }

  const token   = String(body.token || "").trim();
  const purpose = String(body.purpose || "").trim();
  if (!token)                         return json({ success: false, error: "token required",   code: "malformed" }, 400);
  if (!purpose)                       return json({ success: false, error: "purpose required", code: "malformed" }, 400);
  if (!ALLOWED_PURPOSES.has(purpose)) return json({ success: false, error: "unknown purpose",  code: "malformed" }, 400);

  // Consume the token (single-use, expiry-aware) inside a Postgres transaction
  const { data: userId, error: rpcErr } = await supabase.rpc("consume_email_token", {
    p_token:   token,
    p_purpose: purpose,
  });

  if (rpcErr || !userId) {
    const msg  = rpcErr?.message || "consume failed";
    const code =
      /already used/i.test(msg)       ? "already_used"
    : /expired/i.test(msg)            ? "expired"
    : /not found/i.test(msg)          ? "not_found"
    : /purpose mismatch/i.test(msg)   ? "purpose_mismatch"
    : /malformed/i.test(msg)          ? "malformed"
    :                                   "internal";
    const status =
      code === "expired"        ? 410
    : code === "already_used"   ? 410
    : code === "not_found"      ? 404
    : code === "malformed"      ? 400
    : code === "purpose_mismatch" ? 400
    :                             500;
    return json({ success: false, error: msg, code }, status);
  }

  // For signup-style purposes, flip email_confirmed_at if not set
  if (purpose === "signup_individual" || purpose === "signup_business") {
    const { error: updErr } = await supabase.auth.admin.updateUserById(userId as string, {
      email_confirm: true,
    });
    if (updErr) {
      // Token was consumed; surface but don't double-burn the token.
      return json(
        { success: false, error: `verify ok but confirmation flip failed: ${updErr.message}`, code: "internal" },
        500,
      );
    }
  }

  const redirect =
    purpose === "password_reset"     ? `${APP_URL}/reset-password?ok=1` :
    purpose === "email_change"       ? `${APP_URL}/profile?email=updated` :
                                       `${APP_URL}/auth/verified`;

  return json({ success: true, data: { user_id: userId, purpose, redirect } });
});
