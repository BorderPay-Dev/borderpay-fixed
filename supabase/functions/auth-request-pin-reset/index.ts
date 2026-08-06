import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SEND_EMAIL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") ?? "";
const APP_URL = Deno.env.get("BORDERPAY_APP_URL") || Deno.env.get("APP_URL") || "https://app.borderpayafrica.com";
const TOKEN_TTL_MINUTES = 30;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

function randomToken(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    // enumeration-safe response shape
    return json({ success: true, data: { accepted: true } });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id,email,full_name,account_type,is_admin")
    .ilike("email", email)
    .maybeSingle();

  if (!profile?.id || profile?.is_admin === true) {
    // enumeration-safe response shape
    return json({ success: true, data: { accepted: true } });
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString();

  const { error: tokenErr } = await supabase.from("pin_reset_tokens").insert({
    user_id: profile.id,
    token_hash: tokenHash,
    email_snapshot: profile.email,
    expires_at: expiresAt,
  });
  if (tokenErr) {
    return json({ success: false, error: tokenErr.message }, 500);
  }

  if (!SEND_EMAIL_TOKEN) {
    return json({ success: false, error: "SEND_EMAIL_INTERNAL_TOKEN missing" }, 500);
  }

  const template =
    String(profile.account_type || "individual").toLowerCase() === "business"
      ? "business.pin_reset_link"
      : "individual.pin_reset_link";
  const resetUrl = `${APP_URL}/auth/pin-reset?token=${encodeURIComponent(token)}`;
  const props = template.startsWith("business.")
    ? {
        company_name: String((body.company_name as string) || "Your business"),
        contact_full_name: String(profile.full_name || ""),
        reset_url: resetUrl,
        expires_in_minutes: TOKEN_TTL_MINUTES,
      }
    : {
        full_name: String(profile.full_name || ""),
        reset_url: resetUrl,
        expires_in_minutes: TOKEN_TTL_MINUTES,
      };

  const emailResponse = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SEND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify({
      template,
      to: String(profile.email || email),
      user_id: profile.id,
      idempotency_key: `pin_reset_link:${profile.id}:${Math.floor(Date.now() / 300000)}`,
      props,
    }),
  });

  if (!emailResponse.ok) {
    const detail = await emailResponse.text().catch(() => "");
    console.error("auth-request-pin-reset: email delivery failed", emailResponse.status, detail.slice(0, 300));
    await supabase.from("pin_reset_tokens").delete().eq("token_hash", tokenHash);
    return json({ success: false, error: "Unable to send the PIN reset email. Please try again." }, 502);
  }

  return json({ success: true, data: { accepted: true } });
});
