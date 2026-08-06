import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { derivePinHashV2 } from "../_shared/security/pin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
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

  const token = String(body.token || "").trim();
  const newPin = String(body.new_pin || "").trim();

  if (!token) return json({ success: false, error: "token required" }, 400);
  if (!/^\d{6}$/.test(newPin)) return json({ success: false, error: "PIN must be exactly 6 digits" }, 400);

  const tokenHash = await sha256(token);
  const nowIso = new Date().toISOString();

  const { data: rows, error: tokenErr } = await supabase
    .from("pin_reset_tokens")
    .select("id,user_id,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokenErr) return json({ success: false, error: tokenErr.message }, 500);
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row?.id || !row?.user_id) return json({ success: false, error: "Invalid or expired reset link" }, 400);

  const expires = new Date(String(row.expires_at || ""));
  if (!Number.isFinite(expires.getTime()) || expires.getTime() < Date.now()) {
    return json({ success: false, error: "Reset link expired" }, 400);
  }

  const pinHashV2 = await derivePinHashV2(newPin);

  const { data: existingSec } = await supabase
    .from("user_security")
    .select("id")
    .eq("user_id", row.user_id)
    .maybeSingle();

  if (existingSec?.id) {
    const { error: secErr } = await supabase
      .from("user_security")
      .update({
        pin_set: true,
        pin_hash: null,
        pin_hash_v2: pinHashV2,
        pin_failed_attempts: 0,
        failed_pin_attempts: 0,
        pin_locked_until: null,
        pin_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("user_id", row.user_id);
    if (secErr) return json({ success: false, error: secErr.message }, 500);
  } else {
    const { error: insertErr } = await supabase.from("user_security").insert({
      user_id: row.user_id,
      pin_set: true,
      pin_hash: null,
      pin_hash_v2: pinHashV2,
      pin_failed_attempts: 0,
      failed_pin_attempts: 0,
      pin_locked_until: null,
      pin_updated_at: nowIso,
      updated_at: nowIso,
    });
    if (insertErr) return json({ success: false, error: insertErr.message }, 500);
  }

  await supabase
    .from("pin_reset_tokens")
    .update({ used_at: nowIso })
    .eq("id", row.id);

  return json({ success: true, data: { reset: true, user_id: row.user_id } });
});
