import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const supa = createClient(
  SUPABASE_URL,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function requireAdmin(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false as const, status: 401, code: "missing_bearer_token", error: "Authentication required" };
  const { data: authData, error: authErr } = await supa.auth.getUser(token);
  const user = authData?.user;
  if (authErr || !user) return { ok: false as const, status: 401, code: "invalid_auth_token", error: "Unauthorized" };
  const { data: profile } = await supa
    .from("user_profiles")
    .select("id,is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, status: 403, code: "admin_only", error: "Admin access required" };
  return { ok: true as const, userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: "invalid_json_payload", error: "Invalid JSON payload" }, 400);
  }

  const eventId = String(body.event_id || "").trim();
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  const reason = String(body.reason || "").trim().slice(0, 500);
  const forceReason = String(body.force_reason || "").trim().slice(0, 500);
  const correlationId = crypto.randomUUID();
  const maxReplayAttempts = Math.max(1, Math.min(20, Number(Deno.env.get("FLW_WEBHOOK_MAX_REPLAY_ATTEMPTS") || 5)));
  if (!eventId) return json({ success: false, code: "event_id_required", error: "event_id is required" }, 400);
  if (!dryRun && reason.length < 8) {
    return json({
      success: false,
      code: "reason_required",
      error: "reason is required and must be at least 8 characters for non-dry-run replay.",
    }, 400);
  }

  const replayEnabled = (Deno.env.get("FLW_WEBHOOK_ALLOW_REPROCESS_FAILED") || "false").toLowerCase() === "true";
  if (!replayEnabled && !dryRun) {
    return json({
      success: false,
      code: "replay_disabled",
      error: "Webhook replay is disabled. Set FLW_WEBHOOK_ALLOW_REPROCESS_FAILED=true.",
      data: { correlation_id: correlationId },
    }, 412);
  }

  const { data: eventRow, error: eventErr } = await supa
    .from("flutterwave_webhook_events")
    .select("event_id,event_type,flow,processing_status,processing_attempts,last_error,last_replay_attempt_at,payload,received_at,processed_at")
    .eq("event_id", eventId)
    .maybeSingle();

  if (eventErr) {
    return json({ success: false, code: "event_lookup_failed", error: eventErr.message }, 500);
  }
  if (!eventRow) {
    return json({ success: false, code: "event_not_found", error: "Webhook event not found" }, 404);
  }

  const attempts = Number(eventRow.processing_attempts || 0);
  const replayCooldownSeconds = Math.max(0, Math.min(3600, Number(Deno.env.get("FLW_WEBHOOK_REPLAY_COOLDOWN_SECONDS") || 60)));
  const lastReplayAtMs = eventRow.last_replay_attempt_at ? Date.parse(String(eventRow.last_replay_attempt_at)) : NaN;
  const nowMs = Date.now();
  const elapsedSinceReplaySeconds = Number.isFinite(lastReplayAtMs) ? Math.floor((nowMs - lastReplayAtMs) / 1000) : null;
  if (!force && replayCooldownSeconds > 0 && elapsedSinceReplaySeconds !== null && elapsedSinceReplaySeconds < replayCooldownSeconds) {
    return json({
      success: false,
      code: "replay_cooldown_active",
      error: "Replay blocked by cooldown window. Try again later or use force with explicit reason.",
      data: {
        event_id: eventId,
        correlation_id: correlationId,
        replay_cooldown_seconds: replayCooldownSeconds,
        retry_after_seconds: replayCooldownSeconds - elapsedSinceReplaySeconds,
      },
    }, 429);
  }
  if (force && forceReason.length < 12) {
    return json({
      success: false,
      code: "force_reason_required",
      error: "force_reason is required and must be at least 12 characters when force=true.",
      data: { event_id: eventId, correlation_id: correlationId },
    }, 400);
  }
  if (!force && attempts >= maxReplayAttempts) {
    return json({
      success: false,
      code: "max_replay_attempts_exceeded",
      error: "Replay blocked: maximum replay attempts reached. Use force=true only after root-cause review.",
      data: {
        event_id: eventId,
        attempts,
        max_attempts: maxReplayAttempts,
        correlation_id: correlationId,
      },
    }, 409);
  }

  if (!force && String(eventRow.processing_status || "") !== "failed") {
    return json({
      success: false,
      code: "event_not_failed",
      error: "Replay is only allowed for failed events unless force=true.",
      data: {
        event_id: eventRow.event_id,
        processing_status: eventRow.processing_status,
      },
    }, 409);
  }

  if (dryRun) {
    const replayKey = String(Deno.env.get("FLW_WEBHOOK_REPLAY_KEY") || "").trim();
    const signature = String(Deno.env.get("FLW_WEBHOOK_SECRET_HASH") || "").trim();
    return json({
      success: true,
      code: "dry_run_ready",
      data: {
        correlation_id: correlationId,
        event: eventRow,
        would_replay: true,
        reason: reason || null,
        replay_policy: {
          attempts,
          max_attempts: maxReplayAttempts,
          force_required: attempts >= maxReplayAttempts,
          replay_cooldown_seconds: replayCooldownSeconds,
        },
        force_reason: forceReason || null,
        replay_ready: replayEnabled && replayKey.length > 0 && signature.length > 0,
        replay_prerequisites: {
          FLW_WEBHOOK_ALLOW_REPROCESS_FAILED: replayEnabled,
          FLW_WEBHOOK_REPLAY_KEY: replayKey.length > 0,
          FLW_WEBHOOK_SECRET_HASH: signature.length > 0,
        },
      },
    });
  }

  const replayKey = String(Deno.env.get("FLW_WEBHOOK_REPLAY_KEY") || "").trim();
  const signature = String(Deno.env.get("FLW_WEBHOOK_SECRET_HASH") || "").trim();
  if (!replayKey || !signature) {
    return json({
      success: false,
      code: "replay_env_missing",
      error: "FLW_WEBHOOK_REPLAY_KEY and FLW_WEBHOOK_SECRET_HASH are required",
    }, 500);
  }

  await supa
    .from("flutterwave_webhook_events")
    .update({ last_replay_attempt_at: new Date().toISOString() })
    .eq("event_id", eventId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let webhookRes: Response;
  try {
    webhookRes = await fetch(`${SUPABASE_URL}/functions/v1/flutterwave-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-flutterwave-signature": signature,
        "x-borderpay-replay-key": replayKey,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(eventRow.payload || {}),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    await supa.from("admin_action_audit").insert({
      actor_id: admin.userId,
      role: "admin",
      action_type: "flutterwave_webhook_replay",
      target_resource: `flutterwave_webhook_events:${eventId}`,
      request_id: correlationId,
      before_state: {
        processing_status: eventRow.processing_status,
        processing_attempts: eventRow.processing_attempts,
        last_error: eventRow.last_error,
      },
      after_state: {
        replay_error: String((e as any)?.message || "replay_fetch_failed"),
        forced: force,
        reason: reason || null,
        force_reason: forceReason || null,
      },
    });
    return json({
      success: false,
      code: "replay_request_failed",
      error: "Replay request could not be delivered to webhook endpoint.",
      data: { event_id: eventId, correlation_id: correlationId },
    }, 502);
  } finally {
    clearTimeout(timeout);
  }

  const webhookJson = await webhookRes.json().catch(() => ({}));

  await supa.from("admin_action_audit").insert({
    actor_id: admin.userId,
    role: "admin",
    action_type: "flutterwave_webhook_replay",
    target_resource: `flutterwave_webhook_events:${eventId}`,
    request_id: crypto.randomUUID(),
    before_state: {
      processing_status: eventRow.processing_status,
      processing_attempts: eventRow.processing_attempts,
      last_error: eventRow.last_error,
    },
    after_state: {
      webhook_http_status: webhookRes.status,
      webhook_result: webhookJson,
      forced: force,
      correlation_id: correlationId,
      reason: reason || null,
      force_reason: forceReason || null,
    },
  });

  return json({
    success: webhookRes.ok,
    code: webhookRes.ok ? "replay_submitted" : "replay_failed",
    data: {
      event_id: eventId,
      correlation_id: correlationId,
      reason: reason || null,
      force_reason: forceReason || null,
      webhook_http_status: webhookRes.status,
      webhook_result: webhookJson,
    },
  }, webhookRes.ok ? 200 : 502);
});
