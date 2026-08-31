import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { loadAndAssertBridgeIdentityInvariant } from "../_shared/bridge-identity-invariant.ts";
import { bridgeProvider } from "../_shared/providers/bridge.ts";
import { assertScaOperation, classifyScaResidency, CUSTOMER_SCA_ENFORCEMENT_ENABLED, scaPayloadHash } from "../_shared/sca.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
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
    return { ok: response.ok && result?.success === true, status: response.status, result };
  } catch {
    return { ok: false, status: 503, result: { code: "factor_unavailable" } };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveProviderScaRequirement(supabase: any, userId: string) {
  const identity = await loadAndAssertBridgeIdentityInvariant(supabase, userId);
  if (!identity.ok) {
    console.error("sca_bridge_identity_invariant_failed", {
      user_id: userId,
      reason: identity.failure.reason,
    });
    throw new Error("bridge_identity_unavailable");
  }

  const { bridge_customer_id: customerId, verification_status: verificationStatus } = identity.context;
  if (String(verificationStatus || "").toLowerCase() !== "approved" || !customerId) {
    return { required: false, country: null, reason: "verification_not_approved" as const };
  }

  const customer = await bridgeProvider.getCustomerProfile(customerId);
  const requirement = classifyScaResidency(customer.country);
  if (requirement.reason === "residency_unknown") {
    console.error("sca_bridge_residency_missing", { user_id: userId, bridge_customer_id: customerId });
    throw new Error("bridge_residency_unavailable");
  }

  const checkedAt = new Date();
  const { error: scopeError } = await supabase.from("sca_customer_scopes").upsert({
    user_id: userId,
    bridge_customer_id: customerId,
    provider_country: requirement.country,
    sca_required: requirement.required,
    source: "bridge_customer_api",
    checked_at: checkedAt.toISOString(),
    expires_at: new Date(checkedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "user_id" });
  if (scopeError) {
    console.error("sca_scope_persistence_failed", { user_id: userId, code: scopeError.code });
    throw new Error("sca_scope_persistence_failed");
  }
  return requirement;
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

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  if (
    !CUSTOMER_SCA_ENFORCEMENT_ENABLED
    || Deno.env.get("UNIVERSAL_SCA_ENFORCEMENT_ENABLED") !== "true"
  ) {
    return json({
      success: true,
      data: {
        sca_required: false,
        authorization_id: null,
        residency_status: "sca_disabled",
      },
    });
  }

  let residency;
  try {
    // Bridge's Customer API is authoritative for legal residence. Mutable
    // browser/profile country fields must never determine EEA SCA scope.
    residency = await resolveProviderScaRequirement(supabase, user.id);
  } catch (error) {
    console.error("sca_provider_requirement_failed", {
      user_id: user.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({
      success: false,
      code: "sca_scope_unavailable",
      error: "Strong-authentication scope could not be verified. Financial access remains locked.",
    }, 503);
  }
  if (body.action === "requirement") {
    return json({ success: true, data: { sca_required: residency.required, residency_status: residency.reason } });
  }

  if (!residency.required) {
    return json({ success: true, data: { sca_required: false, authorization_id: null } });
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
  const { count, error: rateError } = await supabase
    .from("sca_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("event_type", "authorization_failed")
    .gte("created_at", recentCutoff);
  if (rateError) return json({ success: false, code: "sca_unavailable", error: "Strong authentication is temporarily unavailable." }, 503);
  if ((count || 0) >= 5) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id,
      event_type: "authorization_locked",
      operation: typeof body.operation === "string" ? body.operation : null,
      resource: typeof body.resource === "string" ? body.resource : null,
      reason: "five_failures_within_fifteen_minutes",
    });
    return json({ success: false, code: "sca_locked", error: "Too many failed attempts. Try again later." }, 429);
  }

  // Verify knowledge first. Do not consume a valid one-time TOTP when the PIN
  // is wrong; that creates a needless lockout and weakens retry semantics.
  const pinResult = await verifyFactor("verify-pin", auth, { pin });
  const totpResult = pinResult.ok
    ? await verifyFactor("verify-2fa", auth, { token: totp })
    : { ok: false, status: pinResult.status, result: { code: "pin_rejected" } };
  const payloadHash = await scaPayloadHash(resource, body.request);
  if (!pinResult.ok || !totpResult.ok) {
    await supabase.from("sca_audit_events").insert({
      user_id: user.id,
      event_type: "authorization_failed",
      operation,
      resource,
      payload_hash: payloadHash,
      reason: !pinResult.ok ? "pin_rejected" : "totp_rejected",
    });
    const notEnrolled = pinResult.status === 400 || totpResult.status === 400;
    return json({
      success: false,
      code: notEnrolled ? "sca_enrollment_required" : "sca_factor_rejected",
      error: notEnrolled
        ? "Set up both a transaction PIN and authenticator app before continuing."
        : "Strong authentication failed.",
    }, notEnrolled ? 409 : 401);
  }

  const ttlSeconds = operation === "wallet_access" ? 300 : 120;
  const { data: authorization, error: insertError } = await supabase
    .from("sca_authorizations")
    .insert({
      user_id: user.id,
      operation,
      resource,
      payload_hash: payloadHash,
      verified_factors: ["pin", "totp"],
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    })
    .select("id,expires_at")
    .single();
  if (insertError || !authorization) return json({ success: false, code: "sca_unavailable", error: "Strong authentication could not be recorded." }, 503);

  await supabase.from("sca_audit_events").insert({
    user_id: user.id,
    authorization_id: authorization.id,
    event_type: "authorization_succeeded",
    operation,
    resource,
    payload_hash: payloadHash,
  });
  return json({ success: true, data: { sca_required: true, authorization_id: authorization.id, expires_at: authorization.expires_at } });
});
