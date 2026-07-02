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

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

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

  const maxReplayAttempts = parseBoundedInt(Deno.env.get("FLW_WEBHOOK_MAX_REPLAY_ATTEMPTS"), 5, 1, 20);
  const replayCooldownSeconds = parseBoundedInt(Deno.env.get("FLW_WEBHOOK_REPLAY_COOLDOWN_SECONDS"), 60, 0, 3600);
  const metricsSampleLimit = parseBoundedInt(Deno.env.get("FLW_WEBHOOK_METRICS_SAMPLE_LIMIT"), 1000, 100, 5000);

  const [{ data: allRows, error: allErr }, { count: failed24hCount, error: failed24Err }] = await Promise.all([
    supa
      .from("flutterwave_webhook_events")
      .select("flow,processing_status,processing_attempts,last_error,last_replay_attempt_at,received_at", { count: "exact" })
      .order("received_at", { ascending: false })
      .limit(metricsSampleLimit),
    supa
      .from("flutterwave_webhook_events")
      .select("event_id", { count: "exact", head: true })
      .eq("processing_status", "failed")
      .gte("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  if (allErr || failed24Err) {
    return json({ success: false, code: "metrics_query_failed", error: allErr?.message || failed24Err?.message || "query failed" }, 500);
  }

  const rows = (allRows || []) as Array<Record<string, unknown>>;
  const statusCounts = rows.reduce<Record<string, number>>((acc, r) => {
    const k = String(r.processing_status || "unknown");
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const flowCounts = rows.reduce<Record<string, number>>((acc, r) => {
    const k = String(r.flow || "unknown");
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const replayableFailed = rows.filter((r) => {
    const status = String(r.processing_status || "").toLowerCase();
    const attempts = Number(r.processing_attempts || 0);
    const lastReplayMs = (r as any).last_replay_attempt_at ? Date.parse(String((r as any).last_replay_attempt_at)) : NaN;
    const elapsed = Number.isFinite(lastReplayMs) ? Math.floor((Date.now() - lastReplayMs) / 1000) : null;
    const cooldownActive = replayCooldownSeconds > 0 && elapsed !== null && elapsed < replayCooldownSeconds;
    return status === "failed" && attempts < maxReplayAttempts && !cooldownActive;
  }).length;

  const cooldownBlockedFailed = rows.filter((r) => {
    const status = String(r.processing_status || "").toLowerCase();
    if (status !== "failed") return false;
    const lastReplayMs = (r as any).last_replay_attempt_at ? Date.parse(String((r as any).last_replay_attempt_at)) : NaN;
    const elapsed = Number.isFinite(lastReplayMs) ? Math.floor((Date.now() - lastReplayMs) / 1000) : null;
    return replayCooldownSeconds > 0 && elapsed !== null && elapsed < replayCooldownSeconds;
  }).length;

  const failedByCode = rows.reduce<Record<string, number>>((acc, r) => {
    if (String(r.processing_status || "").toLowerCase() !== "failed") return acc;
    const code = String(((r.last_error as Record<string, unknown> | null)?.code) || "unknown");
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  const failedByFlowAndCode = rows.reduce<Record<string, Record<string, number>>>((acc, r) => {
    if (String(r.processing_status || "").toLowerCase() !== "failed") return acc;
    const flow = String(r.flow || "unknown");
    const code = String(((r.last_error as Record<string, unknown> | null)?.code) || "unknown");
    if (!acc[flow]) acc[flow] = {};
    acc[flow][code] = (acc[flow][code] || 0) + 1;
    return acc;
  }, {});

  const attemptsBuckets = rows.reduce<Record<string, number>>((acc, r) => {
    const n = Number(r.processing_attempts || 0);
    const bucket = n >= maxReplayAttempts ? `>=${maxReplayAttempts}` : String(n);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});

  return json({
    success: true,
    data: {
      totals: {
        tracked_events: rows.length,
        failed_24h: failed24hCount || 0,
        replayable_failed: replayableFailed,
        cooldown_blocked_failed: cooldownBlockedFailed,
      },
      counts: {
        by_status: statusCounts,
        by_flow: flowCounts,
        failed_by_code: failedByCode,
        failed_by_flow_and_code: failedByFlowAndCode,
        attempts_buckets: attemptsBuckets,
      },
      replay_policy: {
        max_attempts: maxReplayAttempts,
        replay_cooldown_seconds: replayCooldownSeconds,
      },
      sampled_window: {
        latest_events_sampled: rows.length,
        sample_limit: metricsSampleLimit,
      },
    },
  });
});
