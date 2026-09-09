import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bridgeEeaPilotAccessRequired,
  bridgeEeaPilotEmailAllowed,
  bridgeEeaScaEnforcementEnabled,
  isBridgeEeaScaCountry,
  resolveBridgeScaScope,
} from "../_shared/bridge-sca-scope.ts";
import { assertScaOperation, scaPayloadHash } from "../_shared/sca.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function verifyFactor(endpoint: "verify-pin" | "verify-2fa", auth: string, body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: auth,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    return { ok: response.ok && result?.success === true, status: response.status };
  } catch {
    return { ok: false, status: 503 };
  } finally {
    clearTimeout(timeout);
  }
}

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
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);
  if (!bridgeEeaScaEnforcementEnabled()) {
    return json({ success: true, data: { required: false, authorization_id: null } });
  }
  const scope = await resolveBridgeScaScope(supabase, user.id);
  if (scope.status === "unknown") {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id,
      event_type: "scope_unavailable",
      reason: scope.reason,
    });
    return json({ success: false, code: "sca_scope_unavailable", error: "Strong-authentication scope could not be verified." }, 503);
  }
  if (
    bridgeEeaPilotAccessRequired() &&
    isBridgeEeaScaCountry(scope.country) &&
    !bridgeEeaPilotEmailAllowed(user.email)
  ) {
    return json({
      success: false,
      code: "eea_pilot_access_locked",
      error: "Contact BorderPay Support to activate EEA strong-authentication testing for this account.",
    }, 423);
  }
  if (!scope.required) return json({ success: true, data: { required: false, authorization_id: null } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const { data: recoveryState, error: recoveryStateError } = await supabase
    .from("user_security")
    .select("sca_recovery_restricted_until,sca_recovery_reason")
    .eq("user_id", user.id)
    .maybeSingle();
  if (recoveryStateError) {
    return json({ success: false, code: "sca_unavailable", error: "Strong authentication is temporarily unavailable." }, 503);
  }
  const restrictedUntil = recoveryState?.sca_recovery_restricted_until
    ? new Date(recoveryState.sca_recovery_restricted_until)
    : null;
  if (restrictedUntil && Number.isFinite(restrictedUntil.getTime()) && restrictedUntil.getTime() > Date.now()) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id,
      event_type: "recovery_restricted",
      operation: typeof body.operation === "string" ? body.operation : null,
      resource: typeof body.resource === "string" ? body.resource : null,
      reason: String(recoveryState?.sca_recovery_reason || "credential_recovery"),
    });
    return json({
      success: false,
      code: "sca_recovery_restricted",
      error: "Protected financial access is temporarily restricted after credential recovery. Contact support if you did not request this change.",
      restricted_until: restrictedUntil.toISOString(),
    }, 423);
  }
  let operation;
  try { operation = assertScaOperation(body.operation); }
  catch { return json({ success: false, code: "invalid_sca_operation", error: "Unsupported protected action." }, 400); }
  const resource = String(body.resource || "").trim();
  const pin = String(body.pin || "");
  const totp = String(body.totp || "");
  if (!/^\d{6}$/.test(pin) || !/^\d{6}$/.test(totp)) {
    return json({ success: false, code: "sca_factors_required", error: "Transaction PIN and 6-digit authenticator code are required." }, 400);
  }

  const recentCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: rateError } = await supabase.from("sca_audit_events")
    .select("id", { count: "exact", head: true }).eq("user_id", user.id)
    .eq("event_type", "authorization_failed").gte("created_at", recentCutoff);
  if (rateError) return json({ success: false, code: "sca_unavailable", error: "Strong authentication is temporarily unavailable." }, 503);
  if ((count || 0) >= 5) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id,
      event_type: "authorization_locked",
      operation,
      resource,
      reason: "five_failures_within_fifteen_minutes",
    });
    return json({ success: false, code: "sca_locked", error: "Too many failed attempts. Try again later." }, 429);
  }

  // Verify knowledge first so a valid one-time TOTP is never consumed after
  // an incorrect PIN. This sequence is part of the Bridge-approved flow.
  const pinResult = await verifyFactor("verify-pin", auth, { pin });
  const totpResult = pinResult.ok
    ? await verifyFactor("verify-2fa", auth, { token: totp })
    : { ok: false, status: pinResult.status };
  const payloadHash = await scaPayloadHash(resource, body.request);
  if (!pinResult.ok || !totpResult.ok) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id, event_type: "authorization_failed", operation, resource,
      payload_hash: payloadHash, reason: !pinResult.ok ? "pin_rejected" : "totp_rejected",
    });
    const notEnrolled = totpResult.status === 400;
    return json({
      success: false,
      code: notEnrolled ? "sca_enrollment_required" : "sca_factor_rejected",
      error: notEnrolled ? "Set up an authenticator app before continuing." : "Strong authentication failed.",
    }, notEnrolled ? 409 : 401);
  }

  const ttlSeconds = operation === "wallet_access" ? 300 : 120;
  const { data: authorization, error: insertError } = await supabase.from("sca_authorizations").insert({
    user_id: user.id, operation, resource, payload_hash: payloadHash,
    verified_factors: ["pin", "totp"], expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }).select("id,expires_at").single();
  if (insertError || !authorization) return json({ success: false, code: "sca_unavailable", error: "Strong authentication could not be recorded." }, 503);
  await supabase.from("sca_audit_events").insert({
    user_id: user.id, authorization_id: authorization.id, event_type: "authorization_succeeded",
    operation, resource, payload_hash: payloadHash,
  });
  return json({ success: true, data: { required: true, authorization_id: authorization.id, expires_at: authorization.expires_at } });
});
