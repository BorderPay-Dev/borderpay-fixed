// webauthn-register-options — server-issued registration challenge.
//
// Returns PublicKeyCredentialCreationOptions for navigator.credentials.create().
// Existing credential ids are excluded so one authenticator is not enrolled
// twice. Stores the challenge with a 5-minute TTL for register-verify.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { generateRegistrationOptions } from "https://esm.sh/@simplewebauthn/server@10.0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const RP_ID = Deno.env.get("WEBAUTHN_RP_ID") || "app.borderpayafrica.com";
const RP_NAME = Deno.env.get("WEBAUTHN_RP_NAME") || "BorderPay Africa";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const { data: { user }, error: authError } = await supa.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: creds } = await supa
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", user.id);

  const excludeCredentials = (creds || []).map((c: any) => ({
    id: c.credential_id,
    type: "public-key",
    transports: c.transports || ["internal"],
  }));

  const displayName = String(user.user_metadata?.full_name || user.email || "BorderPay User").slice(0, 64);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: user.id,
    userName: user.email || user.id,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials,
    timeout: 60_000,
  });

  const { error } = await supa.from("webauthn_challenges").insert({
    user_id: user.id,
    challenge: options.challenge,
    purpose: "register",
    rp_id: RP_ID,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  if (error) return json({ success: false, error: error.message }, 500);

  return json({
    success: true,
    data: {
      options,
      origin: Deno.env.get("WEBAUTHN_ORIGIN") || null,
      rp_id: RP_ID,
    },
  });
});
