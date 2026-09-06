/**
 * Legacy compatibility endpoint for confirmation emails.
 *
 * All delivery is delegated to the unified send-email dispatcher so Brevo is
 * primary, Resend is failure-only fallback, and every attempt is logged.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const INTERNAL_TOKEN = Deno.env.get("SEND_EMAIL_INTERNAL_TOKEN") || "";
const APP_URL = Deno.env.get("BORDERPAY_APP_URL") || "https://app.borderpayafrica.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return response({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!INTERNAL_TOKEN || !timingSafeEqualStr(token, INTERNAL_TOKEN)) {
    return response({ success: false, error: "Unauthorized — internal token required" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return response({ success: false, error: "Invalid JSON" }, 400); }

  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || "there").trim().slice(0, 160);
  const accountType = body.account_type === "business" ? "business" : "individual";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !body.confirmation_url) {
    return response({ success: false, error: "Missing or invalid email or confirmation_url" }, 400);
  }

  let confirmationUrl: URL;
  let appOrigin: URL;
  try {
    confirmationUrl = new URL(String(body.confirmation_url));
    appOrigin = new URL(APP_URL);
  } catch {
    return response({ success: false, error: "Invalid confirmation URL" }, 400);
  }
  if (confirmationUrl.origin !== appOrigin.origin) {
    return response({ success: false, error: "confirmation_url origin not allowed" }, 400);
  }

  const fingerprint = (await sha256(confirmationUrl.toString())).slice(0, 24);
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${INTERNAL_TOKEN}` },
    body: JSON.stringify({
      template: `${accountType}.email_verification`,
      to: email,
      idempotency_key: `legacy-verify:${email}:${fingerprint}`,
      props: { full_name: fullName, verification_url: confirmationUrl.toString() },
    }),
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !(result as any)?.success) {
    return response({ success: false, error: (result as any)?.error || `send-email HTTP ${upstream.status}` }, 502);
  }
  return response({ success: true, data: (result as any).data || null });
});
