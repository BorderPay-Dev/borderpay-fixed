import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bridgeEeaPilotAccessRequired,
  bridgeEeaPilotEmailAllowed,
  bridgeEeaScaEnforcementEnabled,
  isBridgeEeaScaCountry,
  resolveBridgeScaScope,
} from "../_shared/bridge-sca-scope.ts";
import { loadWalletSecurityEnrollment } from "../_shared/wallet-security-enrollment.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const scope = await resolveBridgeScaScope(supabase, user.id);
  if (!bridgeEeaScaEnforcementEnabled()) {
    return json({
      success: true,
      data: {
        ...scope,
        required: false,
        status: "not_required",
        enforcement_enabled: false,
        security_enrollment_required: false,
        missing_security_factors: [],
      },
    });
  }
  if (scope.status === "unknown") {
    return json({ success: false, code: "sca_scope_unavailable", data: scope }, 503);
  }
  if (
    isBridgeEeaScaCountry(scope.country) &&
    bridgeEeaPilotAccessRequired() &&
    !bridgeEeaPilotEmailAllowed(user.email)
  ) {
    return json({
      success: true,
      data: {
        ...scope,
        required: true,
        status: "required",
        enforcement_enabled: true,
        pilot_access_locked: true,
        security_enrollment_required: false,
        missing_security_factors: [],
      },
    });
  }
  if (isBridgeEeaScaCountry(scope.country)) {
    try {
      const enrollment = await loadWalletSecurityEnrollment(supabase, user.id);
      return json({
        success: true,
        data: {
          ...scope,
          enforcement_enabled: true,
          security_enrollment_required: !enrollment.enrolled,
          missing_security_factors: enrollment.missing,
        },
      });
    } catch {
      return json({ success: false, code: "security_status_unavailable", data: scope }, 503);
    }
  }
  return json({
    success: true,
    data: { ...scope, enforcement_enabled: true, security_enrollment_required: false, missing_security_factors: [] },
  });
});
