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
  const batchLimit = Math.max(1, Math.min(50, Number(body?.limit || 10)));
  const reason = String(body?.reason || "batch_replay").slice(0, 250);
  const flow = String(body?.flow || "").toLowerCase();
  const status = String(body?.status || "failed").toLowerCase();

  let q = supa
    .from("flutterwave_webhook_events")
    .select("event_id,processing_attempts,flow,processing_status")
    .eq("processing_status", status || "failed")
    .order("received_at", { ascending: true })
    .limit(200);
  if (flow) q = q.eq("flow", flow);
  const { data: rows, error } = await q;

  if (error) {
    return json({ success: false, code: "candidate_query_failed", error: error.message }, 500);
  }

  const replayable = (rows || []).filter((r: any) => Number(r.processing_attempts || 0) < maxReplayAttempts).slice(0, batchLimit);

  if (dryRun) {
    return json({
      success: true,
      code: "dry_run_ready",
      data: {
        requested_limit: batchLimit,
        filters: { flow: flow || null, status: status || "failed" },
        replayable_count: replayable.length,
        candidates: replayable.map((r: any) => ({ event_id: r.event_id, processing_attempts: r.processing_attempts })),
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
      body: JSON.stringify({ event_id: row.event_id, dry_run: false, force: false, reason }),
    });
    const payload = await res.json().catch(() => ({}));
    results.push({ event_id: row.event_id, status: res.status, ok: res.ok, response: payload });
  }

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
      filters: { flow: flow || null, status: status || "failed" },
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    },
  });
});
