import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bridgeEeaScaEnforcementEnabled, resolveBridgeScaScope } from "../_shared/bridge-sca-scope.ts";
import { scaPayloadHash } from "../_shared/sca.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

async function verifyFactor(endpoint: "verify-pin" | "verify-2fa", authorization: string, body: unknown) {
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const response = await fetch(`${baseUrl}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload?.success === true, status: response.status, payload };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization) return json({ success: false, error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  if (!bridgeEeaScaEnforcementEnabled()) {
    return json({ success: true, data: { required: false, reason: "sca_enforcement_disabled" } });
  }

  const scope = await resolveBridgeScaScope(supabase, user.id);
  if (scope.status === "unknown") {
    return json({ success: false, code: "sca_scope_unavailable", error: "Strong authentication could not be verified. Nothing was changed." }, 503);
  }
  if (scope.status === "not_required") {
    return json({ success: true, data: { required: false, reason: scope.reason } });
  }
  if (body.action === "status") {
    return json({ success: true, data: { required: true, reason: scope.reason } });
  }

  const { data: recoveryState, error: recoveryError } = await supabase
    .from("user_security")
    .select("sca_recovery_restricted_until,sca_recovery_reason")
    .eq("user_id", user.id)
    .maybeSingle();
  if (recoveryError) return json({ success: false, code: "sca_unavailable", error: "Strong authentication is temporarily unavailable." }, 503);
  const restrictedUntil = recoveryState?.sca_recovery_restricted_until
    ? new Date(recoveryState.sca_recovery_restricted_until)
    : null;
  if (restrictedUntil && Number.isFinite(restrictedUntil.getTime()) && restrictedUntil.getTime() > Date.now()) {
    return json({
      success: false,
      code: "sca_recovery_restricted",
      error: "Protected financial access is temporarily restricted after credential recovery.",
      restricted_until: restrictedUntil.toISOString(),
    }, 423);
  }

  // Released mobile clients send operation/resource directly. Newer clients
  // also include action=authorize. Accept both signed contracts.
  if ((body.action && body.action !== "authorize") || body.operation !== "payment" || body.resource !== "bridge_transfer") {
    return json({ success: false, code: "invalid_sca_request", error: "Invalid strong-authentication request." }, 400);
  }
  if (!/^\d{6}$/.test(String(body.pin || "")) || !/^\d{6}$/.test(String(body.totp || ""))) {
    return json({ success: false, code: "invalid_sca_factors", error: "Enter your transaction PIN and current 6-digit authenticator code." }, 400);
  }
  if (!body.request || typeof body.request !== "object" || Array.isArray(body.request)) {
    return json({ success: false, code: "invalid_sca_payload", error: "The payout authorization details are invalid." }, 400);
  }

  const recentCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: rateError } = await supabase.from("sca_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("event_type", "authorization_failed")
    .gte("created_at", recentCutoff);
  if (rateError) return json({ success: false, code: "sca_unavailable", error: "Strong authentication is temporarily unavailable." }, 503);
  if ((count || 0) >= 5) return json({ success: false, code: "sca_locked", error: "Too many failed attempts. Try again later." }, 429);

  const pin = await verifyFactor("verify-pin", authorization, { pin: String(body.pin) });
  if (!pin.ok) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id, event_type: "authorization_failed", operation: "payment", resource: "bridge_transfer", reason: "pin_rejected",
    });
    return json({ success: false, code: "pin_verification_failed", error: pin.payload?.error || "Invalid transaction PIN." }, pin.status === 429 ? 429 : 401);
  }
  const totp = await verifyFactor("verify-2fa", authorization, { token: String(body.totp) });
  if (!totp.ok) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id, event_type: "authorization_failed", operation: "payment", resource: "bridge_transfer", reason: "totp_rejected",
    });
    return json({ success: false, code: "totp_verification_failed", error: totp.payload?.error || "Invalid authenticator code." }, totp.status >= 500 ? 503 : 401);
  }

  const payloadHash = await scaPayloadHash("bridge_transfer", body.request);
  const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  const { data: authorizationRow, error: insertError } = await supabase
    .from("sca_authorizations")
    .insert({
      user_id: user.id,
      operation: "payment",
      resource: "bridge_transfer",
      payload_hash: payloadHash,
      verified_factors: ["pin", "totp"],
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();
  if (insertError || !authorizationRow?.id) {
    console.error("sca_authorization_insert_failed", { user_id: user.id, code: insertError?.code });
    return json({ success: false, code: "sca_unavailable", error: "Strong authentication could not be completed. Nothing was changed." }, 503);
  }

  await supabase.from("sca_audit_events").insert({
    user_id: user.id,
    authorization_id: authorizationRow.id,
    event_type: "authorization_succeeded",
    operation: "payment",
    resource: "bridge_transfer",
    payload_hash: payloadHash,
  });

  return json({
    success: true,
    data: {
      required: true,
      authorization_id: authorizationRow.id,
      expires_at: authorizationRow.expires_at,
    },
  });
});
