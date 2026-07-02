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
  const { data: profile } = await supa.from("user_profiles").select("id,is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, status: 403, code: "admin_only", error: "Admin access required" };
  return { ok: true as const };
}

function envTrue(name: string): boolean {
  return String(Deno.env.get(name) || "").trim().toLowerCase() === "true";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  const maxReplayAttempts = Math.max(1, Math.min(20, Number(Deno.env.get("FLW_WEBHOOK_MAX_REPLAY_ATTEMPTS") || 5)));
  const staticIpGuard = {
    required: envTrue("FLW_STATIC_IP_REQUIRED"),
    ready: envTrue("FLW_STATIC_IP_READY"),
  };
  const staticIpBlocked = staticIpGuard.required && !staticIpGuard.ready;

  const { data: recent, error } = await supa
    .from("flutterwave_webhook_events")
    .select("event_id,flow,processing_status,processing_attempts,last_error,received_at")
    .order("received_at", { ascending: false })
    .limit(500);

  if (error) return json({ success: false, code: "query_failed", error: error.message }, 500);

  const rows = (recent || []) as Array<Record<string, unknown>>;
  const failed = rows.filter((r) => String(r.processing_status || "").toLowerCase() === "failed");
  const replayable = failed.filter((r) => Number(r.processing_attempts || 0) < maxReplayAttempts);

  const topFailureCodes = failed.reduce<Record<string, number>>((acc, r) => {
    const code = String(((r.last_error as Record<string, unknown> | null)?.code) || "unknown");
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  const sortedCodes = Object.entries(topFailureCodes).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const actions: Array<Record<string, unknown>> = [];

  if (staticIpBlocked) {
    actions.push({
      priority: "critical",
      action: "unblock_static_ip_for_money_movement",
      endpoint: null,
      payload: {
        FLW_STATIC_IP_REQUIRED: true,
        FLW_STATIC_IP_READY: false,
      },
      rationale: "Money-movement endpoints are fail-closed while static IP readiness is false.",
    });
  }

  if (replayable.length > 0) {
    actions.push({
      priority: "high",
      action: "batch_replay_failed_events",
      endpoint: "admin-flutterwave-webhook-replay-batch",
      payload: { dry_run: false, limit: Math.min(10, replayable.length), reason: "incident_runbook_batch_replay", status: "failed" },
      rationale: "Replayable failed events are available and below max attempts.",
      estimated_impact_events: replayable.length,
    });
  }

  if (failed.length > 0) {
    actions.push({
      priority: "high",
      action: "triage_top_failed_events",
      endpoint: "admin-flutterwave-webhook-events",
      payload: { status: "failed", only_replayable: false, include_payload: false, limit: 25 },
      rationale: "Inspect latest failed events and error codes before forcing replays.",
      top_failure_codes: sortedCodes,
    });
  }

  actions.push({
    priority: "medium",
    action: "projection_gap_audit",
    endpoint: "admin-flutterwave-projection-audit",
    payload: { limit: 100 },
    rationale: "Detect missing transaction/notification/ledger projections after webhook processing.",
  });

  actions.push({
    priority: "medium",
    action: "projection_gap_repair_dry_run",
    endpoint: "admin-flutterwave-projection-repair",
    payload: { dry_run: true, limit: 50 },
    rationale: "Preview repair actions safely before applying fixes.",
  });

  return json({
    success: true,
    data: {
      snapshot: {
        sampled_events: rows.length,
        failed_events: failed.length,
        replayable_failed_events: replayable.length,
        max_replay_attempts: maxReplayAttempts,
        static_ip_guard: {
          ...staticIpGuard,
          blocked: staticIpBlocked,
        },
      },
      top_failure_codes: sortedCodes,
      recommended_actions: actions,
      generated_at: new Date().toISOString(),
    },
  });
});
