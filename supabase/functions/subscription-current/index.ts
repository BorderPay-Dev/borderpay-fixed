import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: subscription, error } = await db.from("subscriptions")
    .select("id,account_type,monthly_fee,currency,status,payment_status,next_billing_date,last_billed_at,grace_started_at,restricted_at,created_at")
    .eq("user_id", auth.user.id).maybeSingle();
  if (error) return json({ success: false, error: error.message }, 500);
  let recent_transactions: unknown[] = [];
  if (subscription?.id) {
    const { data } = await db.from("billing_transactions")
      .select("id,billing_period,amount,collected_amount,asset,asset_breakdown,status,failure_code,completed_at,created_at")
      .eq("subscription_id", subscription.id).order("created_at", { ascending: false }).limit(12);
    recent_transactions = data ?? [];
  }
  return json({ success: true, data: { subscription, recent_transactions } });
});
