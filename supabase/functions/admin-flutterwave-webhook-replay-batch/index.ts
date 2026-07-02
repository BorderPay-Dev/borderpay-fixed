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
  const { data: profile } = await supa.from("user_profiles").select("id,is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, status: 403, code: "admin_only", error: "Admin access required" };
  return { ok: true as const, userId: user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  let body: any = {};
  try { body = await req.json(); } catch {}

  const dryRun = body?.dry_run !== false;
  const maxReplayAttempts = Math.max(1, Math.min(20, Number(Deno.env.get("FLW_WEBHOOK_MAX_REPLAY_ATTEMPTS") || 5)));
  const replayCooldownSeconds = Math.max(0, Math.min(3600, Number(Deno.env.get("FLW_WEBHOOK_REPLAY_COOLDOWN_SECONDS") || 60)));
  const batchLimit = Math.max(1, Math.min(50, Number(body?.limit || 10)));
  const reason = String(body?.reason || "batch_replay").slice(0, 250);
  const flow = String(body?.flow || "").toLowerCase();
  const status = String(body?.status || "failed").toLowerCase();
  const allowedFlows = ["transfer", "collection"] as const;
  const allowedStatuses = ["failed"] as const;
  const force = body?.force === true;
  const forceReason = String(body?.force_reason || "").trim().slice(0, 500);
  const allowErrorCodes = Array.isArray(body?.allow_error_codes)
    ? body.allow_error_codes.map((v: unknown) => String(v || "").trim()).filter(Boolean)
    : [];
  const excludeErrorCodes = Array.isArray(body?.exclude_error_codes)
    ? body.exclude_error_codes.map((v: unknown) => String(v || "").trim()).filter(Boolean)
    : [];
  const overlappingCodes = allowErrorCodes.filter((code) => excludeErrorCodes.includes(code));
  if (overlappingCodes.length > 0) {
    return json({
      success: false,
      code: "conflicting_error_code_filters",
      error: "allow_error_codes and exclude_error_codes cannot include the same values.",
      data: { overlapping_error_codes: overlappingCodes },
    }, 400);
  }
  if (force && forceReason.length < 12) {
    return json({
      success: false,
      code: "force_reason_required",
      error: "force_reason is required and must be at least 12 characters when force=true.",
    }, 400);
  }
  if (!dryRun && reason.trim().length < 8) {
    return json({
      success: false,
      code: "reason_required",
      error: "reason is required and must be at least 8 characters for non-dry-run batch replay.",
    }, 400);
  }
  if (status !== "failed") {
    return json({
      success: false,
      code: "invalid_status_filter",
      error: "Batch replay only supports status=failed.",
    }, 400);
  }
  if (flow && !allowedFlows.includes(flow as (typeof allowedFlows)[number])) {
    return json({
      success: false,
      code: "invalid_flow_filter",
      error: "flow must be transfer or collection when provided.",
    }, 400);
  }

  let q = supa
    .from("flutterwave_webhook_events")
    .select("event_id,processing_attempts,flow,processing_status,last_error,last_replay_attempt_at")
    .eq("processing_status", status || "failed")
    .order("received_at", { ascending: true })
    .limit(200);
  if (flow) q = q.eq("flow", flow);
  const { data: rows, error } = await q;

  if (error) {
    return json({ success: false, code: "candidate_query_failed", error: error.message }, 500);
  }

  const selectionSummary = {
    scanned: (rows || []).length,
    skipped_max_attempts: 0,
    skipped_cooldown: 0,
    skipped_allow_error_codes: 0,
    skipped_exclude_error_codes: 0,
    selected_before_limit: 0,
    truncated_by_limit: 0,
  };
  const replayableCandidates: any[] = [];
  for (const r of rows || []) {
    const attemptsOk = Number(r.processing_attempts || 0) < maxReplayAttempts;
    if (!attemptsOk) {
      selectionSummary.skipped_max_attempts += 1;
      continue;
    }
    const lastReplayMs = r.last_replay_attempt_at ? Date.parse(String(r.last_replay_attempt_at)) : NaN;
    const elapsed = Number.isFinite(lastReplayMs) ? Math.floor((Date.now() - lastReplayMs) / 1000) : null;
    const cooldownActive = replayCooldownSeconds > 0 && elapsed !== null && elapsed < replayCooldownSeconds;
    if (cooldownActive && !force) {
      selectionSummary.skipped_cooldown += 1;
      continue;
    }
    const code = String((r.last_error || {}).code || "").trim();
    if (allowErrorCodes.length > 0 && !allowErrorCodes.includes(code)) {
      selectionSummary.skipped_allow_error_codes += 1;
      continue;
    }
    if (excludeErrorCodes.length > 0 && excludeErrorCodes.includes(code)) {
      selectionSummary.skipped_exclude_error_codes += 1;
      continue;
    }
    replayableCandidates.push({
      ...r,
      _diagnostics: {
        error_code: code || null,
        cooldown_active: cooldownActive,
        retry_after_seconds: cooldownActive
          ? Math.max(0, replayCooldownSeconds - (elapsed || 0))
          : 0,
      },
    });
  }

  selectionSummary.selected_before_limit = replayableCandidates.length;
  selectionSummary.truncated_by_limit = Math.max(0, replayableCandidates.length - batchLimit);
  const replayable = replayableCandidates.slice(0, batchLimit);

  if (dryRun) {
    return json({
      success: true,
      code: "dry_run_ready",
      data: {
        requested_limit: batchLimit,
        filters: {
          flow: flow || null,
          status: status || "failed",
          allow_error_codes: allowErrorCodes,
          exclude_error_codes: excludeErrorCodes,
          force,
          force_reason: forceReason || null,
          replay_cooldown_seconds: replayCooldownSeconds,
        },
        allowed_filters: {
          flows: allowedFlows,
          statuses: allowedStatuses,
        },
        replayable_count: replayable.length,
        selection_summary: selectionSummary,
        candidates: replayable.map((r: any) => ({
          event_id: r.event_id,
          processing_attempts: r.processing_attempts,
          error_code: r?._diagnostics?.error_code || null,
          cooldown_active: r?._diagnostics?.cooldown_active || false,
          retry_after_seconds: r?._diagnostics?.retry_after_seconds || 0,
        })),
      },
    });
  }

  if (replayable.length === 0) {
    return json({
      success: true,
      code: "no_replayable_events",
      data: {
        attempted: 0,
        filters: {
          flow: flow || null,
          status: status || "failed",
          allow_error_codes: allowErrorCodes,
          exclude_error_codes: excludeErrorCodes,
          force,
          force_reason: forceReason || null,
          replay_cooldown_seconds: replayCooldownSeconds,
        },
        allowed_filters: {
          flows: allowedFlows,
          statuses: allowedStatuses,
        },
        selection_summary: selectionSummary,
      },
    });
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const results: Array<Record<string, unknown>> = [];
  for (const row of replayable) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-flutterwave-webhook-replay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        event_id: row.event_id,
        dry_run: false,
        force,
        reason,
        ...(force ? { force_reason: forceReason } : {}),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    results.push({ event_id: row.event_id, status: res.status, ok: res.ok, response: payload });
  }

  const resultCodeCounts = results.reduce((acc: Record<string, number>, row: any) => {
    const code = String((row?.response || {}).code || (row.ok ? "ok" : `http_${row.status}`));
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  await supa.from("admin_action_audit").insert({
    actor_id: admin.userId,
    role: "admin",
    action_type: "flutterwave_webhook_replay_batch",
    target_resource: "flutterwave_webhook_events",
    request_id: crypto.randomUUID(),
    before_state: { requested_limit: batchLimit, replayable_count: replayable.length },
    after_state: { attempted: results.length, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
  });

  return json({
    success: true,
    code: "batch_replay_executed",
    data: {
      attempted: results.length,
      filters: {
        flow: flow || null,
        status: status || "failed",
        allow_error_codes: allowErrorCodes,
        exclude_error_codes: excludeErrorCodes,
        force,
        force_reason: forceReason || null,
        replay_cooldown_seconds: replayCooldownSeconds,
      },
      allowed_filters: {
        flows: allowedFlows,
        statuses: allowedStatuses,
      },
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      result_code_counts: resultCodeCounts,
      selection_summary: selectionSummary,
      results,
    },
  });
});
