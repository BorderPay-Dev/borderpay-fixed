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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return json({ success: false, code: admin.code, error: admin.error }, admin.status);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 100)));
  const targetUserId = String(body?.user_id || "").trim();

  const [collectionsRes, transfersRes] = await Promise.all([
    (() => {
      let q = supa
      .from("flutterwave_collections")
      .select("tx_ref,status,user_id,business_user_id,flutterwave_event_id,updated_at")
      .in("status", ["completed", "failed"]) 
      .order("updated_at", { ascending: false })
      .limit(limit);
      if (targetUserId) q = q.or(`user_id.eq.${targetUserId},business_user_id.eq.${targetUserId}`);
      return q;
    })(),
    (() => {
      let q = supa
      .from("flutterwave_transfers")
      .select("reference,status,user_id,business_user_id,flutterwave_event_id,updated_at")
      .in("status", ["completed", "failed"]) 
      .order("updated_at", { ascending: false })
      .limit(limit);
      if (targetUserId) q = q.or(`user_id.eq.${targetUserId},business_user_id.eq.${targetUserId}`);
      return q;
    })(),
  ]);

  if (collectionsRes.error || transfersRes.error) {
    return json({
      success: false,
      code: "audit_query_failed",
      error: collectionsRes.error?.message || transfersRes.error?.message || "query failed",
    }, 500);
  }

  const issues: Array<Record<string, unknown>> = [];

  for (const c of (collectionsRes.data || []) as Array<Record<string, unknown>>) {
    const txRef = String(c.tx_ref || "");
    if (!txRef) continue;
    const txReference = `flutterwave:collection:${txRef}`;

    const [{ data: tx }, { data: note }, { data: ledger }] = await Promise.all([
      supa.from("transactions").select("id,status").eq("reference", txReference).maybeSingle(),
      supa.from("notifications").select("id").eq("type", "transaction").contains("metadata", { tx_ref: txRef, source: "flutterwave" }).maybeSingle(),
      supa.from("bridge_balance_ledger").select("id").eq("event_id", `flw:${String(c.flutterwave_event_id || "")}`).maybeSingle(),
    ]);

    const terminal = String(c.status || "").toLowerCase();
    if (!tx?.id) issues.push({ flow: "collection", key: txRef, issue: "missing_transaction", expected_reference: txReference });
    if (terminal === "completed" && !note?.id) issues.push({ flow: "collection", key: txRef, issue: "missing_notification" });
    if (terminal === "completed" && !ledger?.id) issues.push({ flow: "collection", key: txRef, issue: "missing_ledger_entry" });
  }

  for (const t of (transfersRes.data || []) as Array<Record<string, unknown>>) {
    const ref = String(t.reference || "");
    if (!ref) continue;
    const txReference = `flutterwave:transfer:${ref}`;

    const [{ data: tx }, { data: note }, { data: ledger }] = await Promise.all([
      supa.from("transactions").select("id,status").eq("reference", txReference).maybeSingle(),
      supa.from("notifications").select("id").eq("type", "transaction").contains("metadata", { reference: ref, source: "flutterwave" }).maybeSingle(),
      supa.from("bridge_balance_ledger").select("id").eq("event_id", `flw:${String(t.flutterwave_event_id || "")}`).maybeSingle(),
    ]);

    const terminal = String(t.status || "").toLowerCase();
    if (!tx?.id) issues.push({ flow: "transfer", key: ref, issue: "missing_transaction", expected_reference: txReference });
    if ((terminal === "completed" || terminal === "failed") && !note?.id) issues.push({ flow: "transfer", key: ref, issue: "missing_notification" });
    if (terminal === "completed" && !ledger?.id) issues.push({ flow: "transfer", key: ref, issue: "missing_ledger_entry" });
  }

  return json({
    success: true,
    data: {
      sampled: {
        collections: (collectionsRes.data || []).length,
        transfers: (transfersRes.data || []).length,
      },
      target_user_id: targetUserId || null,
      total_issues: issues.length,
      issues,
    },
  });
});
