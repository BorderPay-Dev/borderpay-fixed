// webauthn-register-options — server-issued registration challenge.
//
// Returns PublicKeyCredentialCreationOptions for navigator.credentials.create().
// Excludes already-enrolled credential IDs to avoid duplicate device registration.
// Stores the challenge with 5-minute TTL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { generateRegistrationOptions } from "https://esm.sh/@simplewebauthn/server@10.0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID") || "app.borderpayafrica.com";
const ORIGIN = Deno.env.get("WEBAUTHN_ORIGIN") || "https://app.borderpayafrica.com";
const RP_NAME = Deno.env.get("WEBAUTHN_RP_NAME") || "BorderPay";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data: { user }, error: authError } = await supa.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: creds, error: credsErr } = await supa
    .from("webauthn_credentials")
    .select("credential_id")
    .eq("user_id", user.id);
  if (credsErr) return json({ success: false, error: credsErr.message }, 500);

  const email = String(user.email || "").trim();
  const displayName = String(user.user_metadata?.full_name || user.user_metadata?.name || email || "BorderPay User");
  const userName = email || `user-${user.id}`;

  const options = await generateRegistrationOptions({
    rpID: RP_ID,
    rpName: RP_NAME,
    userName,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: (creds || []).map((c: any) => ({
      id: String(c.credential_id),
      type: "public-key",
    })),
    timeout: 60_000,
  });

  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { error: insertErr } = await supa.from("webauthn_challenges").insert({
    user_id: user.id,
    challenge: options.challenge,
    purpose: "register",
    rp_id: RP_ID,
    expires_at: expiresAt,
  });
  if (insertErr) return json({ success: false, error: insertErr.message }, 500);

  return json({
    success: true,
    data: {
      options,
      origin: ORIGIN,
      rp_id: RP_ID,
    },
  });
});
