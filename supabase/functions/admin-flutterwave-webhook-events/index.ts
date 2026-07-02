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

const supa = createClient(
  Deno.env.get("SUPABASE_URL")!,
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
  return { ok: true as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ success: false, code: "invalid_json_payload", error: "Invalid JSON payload" }, 400);
  }

  const status = String(body?.status || "failed").trim().toLowerCase();
  const flow = String(body?.flow || "").trim().toLowerCase();
  const errorCode = String(body?.error_code || "").trim();
  const includePayload = body?.include_payload === true;
  const onlyReplayable = body?.only_replayable === true;
  const maxReplayAttempts = Math.max(1, Math.min(20, Number(Deno.env.get("FLW_WEBHOOK_MAX_REPLAY_ATTEMPTS") || 5)));
  const replayCooldownSeconds = Math.max(0, Math.min(3600, Number(Deno.env.get("FLW_WEBHOOK_REPLAY_COOLDOWN_SECONDS") || 60)));
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)));
  const from = Math.max(0, Number(body?.from || 0));

  const selectCols = includePayload
    ? "event_id,event_type,flow,processing_status,processing_attempts,last_error,last_replay_attempt_at,payload,received_at,processed_at"
    : "event_id,event_type,flow,processing_status,processing_attempts,last_error,last_replay_attempt_at,received_at,processed_at";

  let query = supa
    .from("flutterwave_webhook_events")
    .select(selectCols, { count: "exact" })
    .order("received_at", { ascending: false })
    .range(from, from + limit - 1);

  if (status) query = query.eq("processing_status", status);
  if (flow) query = query.eq("flow", flow);
  if (errorCode) query = query.filter("last_error->>code", "eq", errorCode);

  const { data, error, count } = await query;
  if (error) {
    return json({ success: false, code: "query_failed", error: error.message }, 500);
  }

  let events = (data || []).map((row: Record<string, unknown>) => {
    const nowMs = Date.now();
    const attempts = Number(row.processing_attempts || 0);
    const statusValue = String(row.processing_status || "").toLowerCase();
    const lastReplayMs = row.last_replay_attempt_at ? Date.parse(String(row.last_replay_attempt_at)) : NaN;
    const elapsed = Number.isFinite(lastReplayMs) ? Math.floor((nowMs - lastReplayMs) / 1000) : null;
    const cooldownActive = replayCooldownSeconds > 0 && elapsed !== null && elapsed < replayCooldownSeconds;
    const retryAfterSeconds = cooldownActive ? replayCooldownSeconds - (elapsed || 0) : 0;
    const replayEligible = statusValue === "failed" && attempts < maxReplayAttempts && !cooldownActive;
    const errorCode = String(((row.last_error as Record<string, unknown> | null)?.code) || "").trim() || null;
    if (includePayload) {
      return {
        ...row,
        error_code: errorCode,
        replay_eligible: replayEligible,
        replay_policy: {
          max_attempts: maxReplayAttempts,
          attempts,
          replay_cooldown_seconds: replayCooldownSeconds,
          cooldown_active: cooldownActive,
          retry_after_seconds: retryAfterSeconds,
        },
      };
    }
    const payload = (row.payload as Record<string, unknown>) || {};
    return {
      ...row,
      error_code: errorCode,
      replay_eligible: replayEligible,
      replay_policy: {
        max_attempts: maxReplayAttempts,
        attempts,
        replay_cooldown_seconds: replayCooldownSeconds,
        cooldown_active: cooldownActive,
        retry_after_seconds: retryAfterSeconds,
      },
      payload_preview: {
        event: payload?.event || payload?.event_type || null,
        data_id: (payload?.data as Record<string, unknown> | undefined)?.id || null,
        tx_ref:
          (payload?.data as Record<string, unknown> | undefined)?.tx_ref
          || (payload?.data as Record<string, unknown> | undefined)?.reference
          || null,
      },
    };
  });

  if (onlyReplayable) {
    events = events.filter((row: any) => row.replay_eligible === true);
  }

  const errorCodeCounts = events.reduce((acc: Record<string, number>, row: any) => {
    const code = String(row?.error_code || "").trim();
    if (!code) return acc;
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  const filteredTotal = events.length;

  return json({
    success: true,
    data: {
      events,
      total: count || 0,
      filtered_total: filteredTotal,
      page: {
        from,
        limit,
        has_more: Number(from) + Number(limit) < Number(count || 0),
      },
      error_code_counts: errorCodeCounts,
      filters: {
        status,
        flow: flow || null,
        error_code: errorCode || null,
        include_payload: includePayload,
        only_replayable: onlyReplayable,
      },
      replay_policy: { max_attempts: maxReplayAttempts, replay_cooldown_seconds: replayCooldownSeconds },
    },
  });
});
