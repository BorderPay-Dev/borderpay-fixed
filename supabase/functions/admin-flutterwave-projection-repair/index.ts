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
  const flow = String(body?.flow || "").toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)));
  const targetUserId = String(body?.user_id || "").trim();

  const actions: Array<Record<string, unknown>> = [];

  if (!flow || flow === "collection") {
    let collectionsQuery = supa
      .from("flutterwave_collections")
      .select("tx_ref,status,amount,currency,user_id,business_user_id,flutterwave_event_id")
      .in("status", ["completed", "failed"])
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (targetUserId) {
      collectionsQuery = collectionsQuery.or(`user_id.eq.${targetUserId},business_user_id.eq.${targetUserId}`);
    }
    const { data: rows } = await collectionsQuery;

    for (const r of (rows || []) as any[]) {
      const txRef = String(r.tx_ref || "");
      if (!txRef) continue;
      const userId = String(r.user_id || r.business_user_id || "");
      if (!userId) continue;
      const reference = `flutterwave:collection:${txRef}`;
      const status = String(r.status || "").toLowerCase();
      const txStatus = status === "completed" ? "completed" : status === "failed" ? "failed" : "pending";

      const { data: tx } = await supa.from("transactions").select("id").eq("reference", reference).maybeSingle();
      if (!tx?.id) {
        actions.push({ flow: "collection", key: txRef, action: "create_transaction", dry_run: dryRun });
        if (!dryRun) {
          await supa.from("transactions").upsert({
            user_id: userId,
            type: "deposit",
            amount: Number(r.amount || 0),
            currency: String(r.currency || "USD"),
            status: txStatus,
            reference,
            provider: "bridge",
            description: "Collection received",
            metadata: { source: "flutterwave", tx_ref: txRef, flutterwave_event_id: r.flutterwave_event_id || null },
            updated_at: new Date().toISOString(),
          }, { onConflict: "reference" });
        }
      }
    }
  }

  if (!flow || flow === "transfer") {
    let transfersQuery = supa
      .from("flutterwave_transfers")
      .select("reference,status,amount,currency,user_id,business_user_id,flutterwave_event_id")
      .in("status", ["completed", "failed"])
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (targetUserId) {
      transfersQuery = transfersQuery.or(`user_id.eq.${targetUserId},business_user_id.eq.${targetUserId}`);
    }
    const { data: rows } = await transfersQuery;

    for (const r of (rows || []) as any[]) {
      const ref = String(r.reference || "");
      if (!ref) continue;
      const userId = String(r.user_id || r.business_user_id || "");
      if (!userId) continue;
      const reference = `flutterwave:transfer:${ref}`;
      const status = String(r.status || "").toLowerCase();
      const txStatus = status === "completed" ? "completed" : status === "failed" ? "failed" : "pending";

      const { data: tx } = await supa.from("transactions").select("id").eq("reference", reference).maybeSingle();
      if (!tx?.id) {
        actions.push({ flow: "transfer", key: ref, action: "create_transaction", dry_run: dryRun });
        if (!dryRun) {
          await supa.from("transactions").upsert({
            user_id: userId,
            type: "transfer",
            amount: Number(r.amount || 0),
            currency: String(r.currency || "USD"),
            status: txStatus,
            reference,
            provider: "bridge",
            description: "Transfer payout",
            metadata: { source: "flutterwave", reference: ref, flutterwave_event_id: r.flutterwave_event_id || null },
            updated_at: new Date().toISOString(),
          }, { onConflict: "reference" });
        }
      }
    }
  }

  await supa.from("admin_action_audit").insert({
    actor_id: admin.userId,
    role: "admin",
    action_type: "flutterwave_projection_repair",
    target_resource: `flow:${flow || "all"}`,
    request_id: crypto.randomUUID(),
    before_state: { dry_run: dryRun, flow: flow || "all", limit, target_user_id: targetUserId || null },
    after_state: { actions_count: actions.length },
  });

  const actionSummary = actions.reduce<Record<string, number>>((acc, item) => {
    const key = String(item.action || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return json({
    success: true,
    data: {
      dry_run: dryRun,
      flow: flow || "all",
      target_user_id: targetUserId || null,
      actions_count: actions.length,
      action_summary: actionSummary,
      actions,
    },
  });
});
