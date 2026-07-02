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
  return { ok: true as const, userId: user.id };
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

  const dryRun = body?.dry_run !== false;
  const retainDays = Math.max(7, Math.min(365, Number(body?.retain_days || 30)));
  const maxBatches = Math.max(1, Math.min(20, Number(body?.max_batches || 5)));
  const batchSize = Math.max(100, Math.min(1000, Number(body?.batch_size || 1000)));
  const cutoffIso = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString();
  const { count: eligibleCount, error: eligibleCountErr } = await supa
    .from("flutterwave_webhook_events")
    .select("event_id", { count: "exact", head: true })
    .in("processing_status", ["completed", "duplicate_ignored"])
    .lt("received_at", cutoffIso);
  if (eligibleCountErr) {
    return json({ success: false, code: "cleanup_count_failed", error: eligibleCountErr.message }, 500);
  }

  if (dryRun) {
    const { data: sampleRows, error: sampleErr } = await supa
      .from("flutterwave_webhook_events")
      .select("event_id,processing_status,received_at")
      .in("processing_status", ["completed", "duplicate_ignored"])
      .lt("received_at", cutoffIso)
      .order("received_at", { ascending: true })
      .limit(batchSize);
    if (sampleErr) {
      return json({ success: false, code: "cleanup_query_failed", error: sampleErr.message }, 500);
    }
    const sampleIds = (sampleRows || []).map((r: any) => String(r.event_id || "")).filter(Boolean);
    return json({
      success: true,
      code: "dry_run_ready",
      data: {
        retain_days: retainDays,
        cutoff: cutoffIso,
        max_batches: maxBatches,
        batch_size: batchSize,
        eligible_count: eligibleCount || 0,
        sample_event_ids: sampleIds.slice(0, 20),
      },
    });
  }

  let deletedCount = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const { data: candidates, error: candidateErr } = await supa
      .from("flutterwave_webhook_events")
      .select("event_id,processing_status,received_at")
      .in("processing_status", ["completed", "duplicate_ignored"])
      .lt("received_at", cutoffIso)
      .order("received_at", { ascending: true })
      .limit(batchSize);
    if (candidateErr) {
      return json({ success: false, code: "cleanup_query_failed", error: candidateErr.message }, 500);
    }
    const batchIds = (candidates || []).map((r: any) => String(r.event_id || "")).filter(Boolean);
    if (batchIds.length === 0) break;

    const { error: delErr, count } = await supa
      .from("flutterwave_webhook_events")
      .delete({ count: "exact" })
      .in("event_id", batchIds)
      .in("processing_status", ["completed", "duplicate_ignored"]);
    if (delErr) {
      return json({ success: false, code: "cleanup_delete_failed", error: delErr.message }, 500);
    }
    deletedCount += count || 0;
    if (batchIds.length < batchSize) break;
  }

  await supa.from("admin_action_audit").insert({
    actor_id: admin.userId,
    role: "admin",
    action_type: "flutterwave_webhook_cleanup",
    target_resource: "flutterwave_webhook_events",
    request_id: crypto.randomUUID(),
    before_state: { retain_days: retainDays, eligible_count: eligibleCount || 0, cutoff: cutoffIso },
    after_state: { deleted_count: deletedCount, max_batches: maxBatches, batch_size: batchSize },
  });

  return json({
    success: true,
    code: "cleanup_completed",
    data: {
      retain_days: retainDays,
      cutoff: cutoffIso,
      max_batches: maxBatches,
      batch_size: batchSize,
      eligible_count: eligibleCount || 0,
      deleted_count: deletedCount,
    },
  });
});
