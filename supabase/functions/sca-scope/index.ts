import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeEeaScaEnforcementEnabled, resolveBridgeScaScope, resolveBridgeWalletAssetScope } from "../_shared/bridge-sca-scope.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  // Refresh the RLS country observation for installed clients as well as the
  // new inventory-independent product endpoint.
  const assets = await resolveBridgeWalletAssetScope(supabase, user.id);
  if (body?.action === "wallet_assets") {
    return json({ success: assets.region !== "unknown", data: assets,
      ...(assets.region === "unknown" ? { code: "wallet_scope_unavailable", error: "Wallet options are temporarily unavailable. Please try again shortly." } : {}) }, assets.region === "unknown" ? 503 : 200);
  }

  const scope = await resolveBridgeScaScope(supabase, user.id);
  if (!bridgeEeaScaEnforcementEnabled() && scope.status !== "not_required") {
    return json({ success: false, code: "sca_unavailable", error: "Strong authentication is temporarily unavailable.", data: scope }, 503);
  }
  if (scope.status === "unknown") {
    return json({ success: false, code: "sca_scope_unavailable", error: "Payment authentication is temporarily unavailable. Please try again shortly.", data: scope }, 503);
  }

  let securityEnrollmentRequired = false;
  let missingSecurityFactors: string[] = [];
  if (scope.required) {
    const { data: security, error: securityError } = await supabase
      .from("user_security")
      .select("pin_set,pin_hash,pin_hash_v2,two_factor_enabled,two_factor_secret_encrypted")
      .eq("user_id", user.id)
      .maybeSingle();
    if (securityError) return json({ success: false, code: "security_status_unavailable", error: "Security settings are temporarily unavailable. Please try again shortly." }, 503);
    const pinReady = security?.pin_set === true && Boolean(String(security?.pin_hash_v2 || security?.pin_hash || "").trim());
    const encryptedTotp = security?.two_factor_secret_encrypted;
    const totpReady = security?.two_factor_enabled === true && Boolean(
      (typeof encryptedTotp === "string" && encryptedTotp.trim())
      || (Array.isArray(encryptedTotp) && encryptedTotp.length)
      || encryptedTotp instanceof Uint8Array
    );
    if (!pinReady) missingSecurityFactors.push("transaction_pin");
    if (!totpReady) missingSecurityFactors.push("authenticator");
    securityEnrollmentRequired = missingSecurityFactors.length > 0;
  }

  return json({
    success: true,
    data: {
      ...scope,
      enforcement_enabled: true,
      security_enrollment_required: securityEnrollmentRequired,
      missing_security_factors: missingSecurityFactors,
    },
  });
});
