// subscription-current — return the caller's active subscription row and a
// recent-invoices list. Read-only.
//
// POST (no body). Response:
//   {
//     success: true,
//     data: {
//       subscription: {
//         id, plan_key, status,
//         current_period_start, current_period_end, cancel_at_period_end
//       } | null,
//       recent_invoices: Array<{
//         id, plan_key, amount_usd_cents, status, paid_at, created_at
//       }>
//     }
//   }
//
// Auth: standard supabase.auth.getUser(token). RLS protects rows, but we
// also branch on account_type so business accounts get the
// business_user_id row and individuals get the user_id row.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ success: false, error: "POST only" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ success: false, error: "Authorization required" }, 401);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json({ success: false, error: "Unauthorized" }, 401);

  const { data: subscription, error } = await db.from("subscriptions")
    .select("id,account_type,monthly_fee,currency,status,payment_status,next_billing_date,last_billed_at,grace_started_at,restricted_at,created_at")
    .eq("user_id", auth.user.id).maybeSingle();
  if (error) return json({ success: false, error: error.message }, 500);
  let recent_transactions: unknown[] = [];
  let payment_invoice: unknown = null;
  if (subscription?.id) {
    const [transactionsResult, invoiceResult] = await Promise.all([
      db.from("billing_transactions")
        .select("id,billing_period,amount,collected_amount,asset,asset_breakdown,status,failure_code,completed_at,created_at")
        .eq("subscription_id", subscription.id).order("created_at", { ascending: false }).limit(12),
      db.from("subscription_external_invoices")
        .select("id,amount,currency,billing_period,status,payment_link,expires_at,created_at")
        .eq("subscription_id", subscription.id)
        .in("status", ["pending_configuration", "payment_link_created", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (transactionsResult.error) return json({ success: false, error: transactionsResult.error.message }, 500);
    recent_transactions = transactionsResult.data ?? [];
    // This table was introduced after the base subscription schema. A missing
    // table must not block account access while an environment is upgrading.
    if (!invoiceResult.error) payment_invoice = invoiceResult.data ?? null;
  }
  return json({ success: true, data: { subscription, recent_transactions, payment_invoice } });
});
