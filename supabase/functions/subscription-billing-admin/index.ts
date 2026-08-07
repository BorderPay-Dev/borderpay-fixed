import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: auth } = await db.auth.getUser(token);
  if (!auth.user) return json({ success: false, error: "Unauthorized" }, 401);
  const { data: profile } = await db.from("user_profiles").select("is_admin").eq("id", auth.user.id).maybeSingle();
  if (profile?.is_admin !== true) return json({ success: false, error: "Admin access required" }, 403);
  const [subs, txs, revenue, logs, failed] = await Promise.all([
    db.from("subscriptions").select("status,payment_status,account_type", { count: "exact" }),
    db.from("billing_transactions").select("id,user_id,billing_period,amount,collected_amount,asset,asset_breakdown,status,failure_code,created_at").order("created_at", { ascending: false }).limit(100),
    db.from("billing_revenue_wallets").select("asset,network,balance_minor,status,maintenance_wallet_whitelist(address)"),
    db.from("subscription_admin_logs").select("*").order("created_at", { ascending: false }).limit(100),
    db.from("subscriptions").select("id,user_id,account_type,monthly_fee,next_billing_date,grace_started_at,restricted_at").eq("payment_status", "failed").order("grace_started_at"),
  ]);
  const rows = subs.data ?? [];
  return json({ success: true, data: {
    summary: {
      total: subs.count ?? rows.length,
      active: rows.filter((x) => x.status === "active").length,
      payment_failed: rows.filter((x) => x.payment_status === "failed").length,
      individual: rows.filter((x) => x.account_type === "individual").length,
      business: rows.filter((x) => x.account_type === "business").length,
    },
    revenue_wallets: revenue.data ?? [], failed_subscriptions: failed.data ?? [],
    recent_transactions: txs.data ?? [], admin_logs: logs.data ?? [],
  } });
});
